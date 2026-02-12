import { test, expect } from '@playwright/test';
import { join } from 'path';

const SCREENSHOT_DIR = join(__dirname, 'screenshots');

test.describe('Animation Check – WASD movement', () => {
  test('full animation walkthrough', async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const consoleAll: string[] = [];

    // Capture ALL console messages
    page.on('console', (msg) => {
      const text = `[${msg.type()}] ${msg.text()}`;
      consoleAll.push(text);
      if (msg.type() === 'error') consoleErrors.push(msg.text());
      if (msg.type() === 'warning') consoleWarnings.push(msg.text());
    });

    // Capture page errors (uncaught exceptions)
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    // Step 1: Navigate and wait for load
    console.log('Step 1: Navigating to http://localhost:5173/ ...');
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for canvas to appear
    const canvas = page.locator('canvas');
    await canvas.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(3000);

    // Step 2: Take screenshot of initial state (loader screen)
    console.log('Step 2: Taking initial state screenshot...');
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'anim-01-initial-state.png'),
      fullPage: true,
    });

    // Step 3: Click GENERATE button
    console.log('Step 3: Clicking GENERATE button...');
    const generateBtn = page.locator('button:has-text("GENERATE")');
    await generateBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await generateBtn.click();

    // Step 4: Wait for game to load
    console.log('Step 4: Waiting for game scene to load...');
    await page.waitForTimeout(4000);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'anim-02-after-generate.png'),
      fullPage: true,
    });

    // Access R3F scene by walking the React fiber tree from canvas
    console.log('Inspecting scene via React fiber tree...');
    const sceneInfo = await page.evaluate(() => {
      const results: any = {};
      try {
        const canvasEl = document.querySelector('canvas');
        if (!canvasEl) return { error: 'No canvas' };

        // Find the React fiber key
        const fiberKey = Object.keys(canvasEl).find(k => k.startsWith('__reactFiber$'));
        if (!fiberKey) return { error: 'No fiber key on canvas' };

        // Walk up the fiber tree to find the R3F root store
        let fiber = (canvasEl as any)[fiberKey];
        let scene: any = null;
        let depth = 0;
        const maxDepth = 50;

        // R3F creates its own renderer — the scene is stored in the store
        // The store is typically on the Canvas fiber's stateNode or memoizedState
        while (fiber && depth < maxDepth) {
          // Check memoizedState for R3F store
          let state = fiber.memoizedState;
          while (state) {
            if (state.queue?.lastRenderedState?.scene) {
              scene = state.queue.lastRenderedState.scene;
              results.foundVia = `fiber depth ${depth}, memoizedState.queue.lastRenderedState`;
              break;
            }
            if (state.memoizedState?.scene) {
              scene = state.memoizedState.scene;
              results.foundVia = `fiber depth ${depth}, memoizedState.memoizedState`;
              break;
            }
            state = state.next;
          }
          if (scene) break;

          // Also check stateNode
          if (fiber.stateNode?.store?.getState?.()?.scene) {
            scene = fiber.stateNode.store.getState().scene;
            results.foundVia = `fiber depth ${depth}, stateNode.store`;
            break;
          }

          fiber = fiber.return;
          depth++;
        }

        if (!scene) {
          // Alternative approach: scan ALL fibers from root looking for __r3f
          const rootFiber = (canvasEl as any)[fiberKey];
          const queue: any[] = [rootFiber];
          const visited = new Set();
          let found = false;

          while (queue.length > 0 && !found) {
            const f = queue.shift();
            if (!f || visited.has(f)) continue;
            visited.add(f);

            // Check if this fiber's stateNode is a Three.js scene
            if (f.stateNode && f.stateNode.isScene) {
              scene = f.stateNode;
              results.foundVia = 'fiber BFS stateNode.isScene';
              found = true;
              break;
            }

            // Check pendingProps for __r3f objects
            if (f.pendingProps?.object?.isScene) {
              scene = f.pendingProps.object;
              results.foundVia = 'fiber BFS pendingProps.object.isScene';
              found = true;
              break;
            }

            if (f.child) queue.push(f.child);
            if (f.sibling) queue.push(f.sibling);
            if (f.return && !visited.has(f.return)) queue.push(f.return);
          }
        }

        if (!scene) {
          // Last resort: check window for exposed Three.js objects
          results.error = 'Could not find R3F scene via fiber tree';
          results.depth = depth;
          return results;
        }

        results.sceneFound = true;

        // Now enumerate the scene
        let totalObjects = 0;
        let skinnedMeshCount = 0;
        const skinnedMeshNames: string[] = [];
        let boneCount = 0;
        const objectsWithAnims: any[] = [];
        const mixerActions: any[] = [];

        scene.traverse((obj: any) => {
          totalObjects++;

          if (obj.isSkinnedMesh) {
            skinnedMeshCount++;
            skinnedMeshNames.push(obj.name || '(unnamed)');
          }

          if (obj.isBone) boneCount++;

          if (obj.animations && obj.animations.length > 0) {
            objectsWithAnims.push({
              name: obj.name || obj.type,
              animNames: obj.animations.map((a: any) => a.name),
            });
          }

          // Look for animation mixers attached to objects
          for (const key of Object.getOwnPropertyNames(obj)) {
            try {
              const val = obj[key];
              if (val && typeof val === 'object' && val._actions && Array.isArray(val._actions)) {
                const actionInfo = val._actions.map((a: any) => ({
                  clipName: a._clip?.name || '?',
                  running: a.isRunning?.() ?? false,
                  weight: a.getEffectiveWeight?.() ?? 0,
                  enabled: a.enabled ?? false,
                  paused: a.paused ?? false,
                }));
                mixerActions.push({
                  parentName: obj.name || obj.type,
                  propKey: key,
                  actions: actionInfo,
                });
              }
            } catch { /* skip */ }
          }
        });

        results.totalObjects = totalObjects;
        results.skinnedMeshCount = skinnedMeshCount;
        results.skinnedMeshNames = skinnedMeshNames;
        results.boneCount = boneCount;
        results.objectsWithAnimations = objectsWithAnims;
        results.mixerActions = mixerActions;

      } catch (e: any) {
        results.error = e.message;
        results.stack = e.stack?.split('\n').slice(0, 5);
      }
      return results;
    });
    console.log('Scene info:', JSON.stringify(sceneInfo, null, 2));

    // Step 5a: Press W (forward) for 1.5 seconds
    console.log('\nStep 5a: Pressing W (forward) for 1.5 seconds...');
    await page.keyboard.down('w');
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'anim-03-walk-forward-W.png'),
      fullPage: true,
    });

    // Capture mixer state during W press
    const walkForwardInfo = await page.evaluate(() => {
      // Re-find scene (same approach)
      const canvasEl = document.querySelector('canvas');
      if (!canvasEl) return { error: 'No canvas' };
      const fiberKey = Object.keys(canvasEl).find(k => k.startsWith('__reactFiber$'));
      if (!fiberKey) return { error: 'No fiber' };

      // BFS for scene
      const rootFiber = (canvasEl as any)[fiberKey];
      const queue: any[] = [rootFiber];
      const visited = new Set();
      let scene: any = null;

      while (queue.length > 0) {
        const f = queue.shift();
        if (!f || visited.has(f)) continue;
        visited.add(f);
        if (f.stateNode?.isScene) { scene = f.stateNode; break; }
        if (f.pendingProps?.object?.isScene) { scene = f.pendingProps.object; break; }
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
        if (f.return && !visited.has(f.return)) queue.push(f.return);
      }

      if (!scene) return { error: 'No scene' };

      const result: any = { phase: 'walk-forward', activeAnims: [] };
      scene.traverse((obj: any) => {
        for (const key of Object.getOwnPropertyNames(obj)) {
          try {
            const val = obj[key];
            if (val?._actions && Array.isArray(val._actions)) {
              for (const a of val._actions) {
                if (a.isRunning?.() || a.getEffectiveWeight?.() > 0.01) {
                  result.activeAnims.push({
                    clip: a._clip?.name || '?',
                    weight: Math.round((a.getEffectiveWeight?.() ?? 0) * 1000) / 1000,
                    running: a.isRunning?.() ?? false,
                  });
                }
              }
            }
          } catch { /* skip */ }
        }
      });
      return result;
    });
    console.log('Walk forward active anims:', JSON.stringify(walkForwardInfo, null, 2));

    await page.keyboard.up('w');
    await page.waitForTimeout(300);

    // Step 5b: Press A (left) for 1.5 seconds
    console.log('Step 5b: Pressing A (left) for 1.5 seconds...');
    await page.keyboard.down('a');
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'anim-04-walk-left-A.png'),
      fullPage: true,
    });

    const walkLeftInfo = await page.evaluate(() => {
      const canvasEl = document.querySelector('canvas');
      if (!canvasEl) return { error: 'No canvas' };
      const fiberKey = Object.keys(canvasEl).find(k => k.startsWith('__reactFiber$'));
      if (!fiberKey) return { error: 'No fiber' };
      const rootFiber = (canvasEl as any)[fiberKey];
      const queue: any[] = [rootFiber];
      const visited = new Set();
      let scene: any = null;
      while (queue.length > 0) {
        const f = queue.shift();
        if (!f || visited.has(f)) continue;
        visited.add(f);
        if (f.stateNode?.isScene) { scene = f.stateNode; break; }
        if (f.pendingProps?.object?.isScene) { scene = f.pendingProps.object; break; }
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
        if (f.return && !visited.has(f.return)) queue.push(f.return);
      }
      if (!scene) return { error: 'No scene' };
      const result: any = { phase: 'walk-left', activeAnims: [] };
      scene.traverse((obj: any) => {
        for (const key of Object.getOwnPropertyNames(obj)) {
          try {
            const val = obj[key];
            if (val?._actions && Array.isArray(val._actions)) {
              for (const a of val._actions) {
                if (a.isRunning?.() || a.getEffectiveWeight?.() > 0.01) {
                  result.activeAnims.push({
                    clip: a._clip?.name || '?',
                    weight: Math.round((a.getEffectiveWeight?.() ?? 0) * 1000) / 1000,
                    running: a.isRunning?.() ?? false,
                  });
                }
              }
            }
          } catch { /* skip */ }
        }
      });
      return result;
    });
    console.log('Walk left active anims:', JSON.stringify(walkLeftInfo, null, 2));

    await page.keyboard.up('a');
    await page.waitForTimeout(300);

    // Step 5c: Press D (right) for 1.5 seconds
    console.log('Step 5c: Pressing D (right) for 1.5 seconds...');
    await page.keyboard.down('d');
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'anim-05-walk-right-D.png'),
      fullPage: true,
    });

    const walkRightInfo = await page.evaluate(() => {
      const canvasEl = document.querySelector('canvas');
      if (!canvasEl) return { error: 'No canvas' };
      const fiberKey = Object.keys(canvasEl).find(k => k.startsWith('__reactFiber$'));
      if (!fiberKey) return { error: 'No fiber' };
      const rootFiber = (canvasEl as any)[fiberKey];
      const queue: any[] = [rootFiber];
      const visited = new Set();
      let scene: any = null;
      while (queue.length > 0) {
        const f = queue.shift();
        if (!f || visited.has(f)) continue;
        visited.add(f);
        if (f.stateNode?.isScene) { scene = f.stateNode; break; }
        if (f.pendingProps?.object?.isScene) { scene = f.pendingProps.object; break; }
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
        if (f.return && !visited.has(f.return)) queue.push(f.return);
      }
      if (!scene) return { error: 'No scene' };
      const result: any = { phase: 'walk-right', activeAnims: [] };
      scene.traverse((obj: any) => {
        for (const key of Object.getOwnPropertyNames(obj)) {
          try {
            const val = obj[key];
            if (val?._actions && Array.isArray(val._actions)) {
              for (const a of val._actions) {
                if (a.isRunning?.() || a.getEffectiveWeight?.() > 0.01) {
                  result.activeAnims.push({
                    clip: a._clip?.name || '?',
                    weight: Math.round((a.getEffectiveWeight?.() ?? 0) * 1000) / 1000,
                    running: a.isRunning?.() ?? false,
                  });
                }
              }
            }
          } catch { /* skip */ }
        }
      });
      return result;
    });
    console.log('Walk right active anims:', JSON.stringify(walkRightInfo, null, 2));

    await page.keyboard.up('d');
    await page.waitForTimeout(300);

    // Step 5d: Press S (backward) for 1.5 seconds
    console.log('Step 5d: Pressing S (backward) for 1.5 seconds...');
    await page.keyboard.down('s');
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'anim-06-walk-backward-S.png'),
      fullPage: true,
    });

    await page.keyboard.up('s');
    await page.waitForTimeout(300);

    // Step 6: Report console errors
    console.log('\n========================================');
    console.log('=== STEP 6: CONSOLE ERROR REPORT ===');
    console.log('========================================');

    console.log('\n--- CONSOLE ERRORS ---');
    if (consoleErrors.length === 0) {
      console.log('NONE');
    } else {
      for (const err of consoleErrors) {
        console.log('  ERROR:', err);
      }
    }

    console.log('\n--- PAGE ERRORS (uncaught exceptions) ---');
    if (pageErrors.length === 0) {
      console.log('NONE');
    } else {
      for (const err of pageErrors) {
        console.log('  PAGE ERROR:', err);
      }
    }

    console.log('\n--- CONSOLE WARNINGS ---');
    if (consoleWarnings.length === 0) {
      console.log('NONE');
    } else {
      for (const warn of consoleWarnings) {
        console.log('  WARNING:', warn);
      }
    }

    // Filter for animation-related messages
    const animRelated = consoleAll.filter(
      (msg) =>
        msg.toLowerCase().includes('anim') ||
        msg.toLowerCase().includes('clip') ||
        msg.toLowerCase().includes('action') ||
        msg.toLowerCase().includes('undefined') ||
        msg.toLowerCase().includes('skeleton') ||
        msg.toLowerCase().includes('mixer') ||
        msg.toLowerCase().includes('bone') ||
        msg.toLowerCase().includes('rifle') ||
        msg.toLowerCase().includes('walk') ||
        msg.toLowerCase().includes('run') ||
        msg.toLowerCase().includes('idle') ||
        msg.toLowerCase().includes('sprint')
    );
    console.log('\n--- ANIMATION-RELATED CONSOLE MESSAGES ---');
    if (animRelated.length === 0) {
      console.log('NONE');
    } else {
      for (const msg of animRelated) {
        console.log(' ', msg);
      }
    }

    console.log('\n--- ALL CONSOLE MESSAGES ---');
    for (const msg of consoleAll) {
      console.log(' ', msg);
    }

    // Final screenshot
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'anim-07-final-state.png'),
      fullPage: true,
    });
  });
});
