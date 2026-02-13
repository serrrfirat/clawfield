import { test, expect } from '@playwright/test';

test('two players can see each other', async ({ browser }) => {
  // Open two separate browser contexts (like two different browsers)
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  // Collect console logs
  const logs1: string[] = [];
  const logs2: string[] = [];
  page1.on('console', msg => logs1.push(`[P1] ${msg.text()}`));
  page2.on('console', msg => logs2.push(`[P2] ${msg.text()}`));

  // Navigate both to the game
  await page1.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  // Small delay so first client creates room + game starts
  await page1.waitForTimeout(5000);

  await page2.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(5000);

  // Check store state on both pages
  const state1 = await page1.evaluate(() => {
    const store = (window as any).__ZUSTAND_STORE__;
    if (!store) return { error: 'no store found on window' };
    const s = store.getState();
    const remotes = Array.from(s.remotePlayers.entries()).map(([id, p]: any) => ({
      id, alive: p.alive, downed: p.downed, pos: p.position, team: p.team
    }));
    return {
      myId: s.myId,
      connected: s.connected,
      alive: s.alive,
      downed: s.downed,
      remoteCount: s.remotePlayers.size,
      remotes,
    };
  });

  const state2 = await page2.evaluate(() => {
    const store = (window as any).__ZUSTAND_STORE__;
    if (!store) return { error: 'no store found on window' };
    const s = store.getState();
    const remotes = Array.from(s.remotePlayers.entries()).map(([id, p]: any) => ({
      id, alive: p.alive, downed: p.downed, pos: p.position, team: p.team
    }));
    return {
      myId: s.myId,
      connected: s.connected,
      alive: s.alive,
      downed: s.downed,
      remoteCount: s.remotePlayers.size,
      remotes,
    };
  });

  console.log('=== Page 1 State ===');
  console.log(JSON.stringify(state1, null, 2));
  console.log('=== Page 2 State ===');
  console.log(JSON.stringify(state2, null, 2));

  // Check Three.js scene for ALL meshes (our simplified boxes)
  const inspectScene = async (page: any, label: string) => {
    return page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'no canvas' };
      const fiberRoot = (canvas as any).__r3f;
      if (!fiberRoot) return { error: 'no r3f root' };
      const scene = fiberRoot.scene || fiberRoot.store?.getState()?.scene;
      if (!scene) return { error: 'no scene' };

      const meshes: any[] = [];
      const allObjects: any[] = [];
      scene.traverse((obj: any) => {
        allObjects.push({
          type: obj.type,
          name: obj.name || '(unnamed)',
          visible: obj.visible,
        });
        if (obj.type === 'Mesh') {
          const geo = obj.geometry?.type || 'unknown';
          const mat = obj.material?.type || 'unknown';
          const color = obj.material?.color ? '#' + obj.material.color.getHexString() : null;
          meshes.push({
            name: obj.name,
            geo,
            mat,
            color,
            visible: obj.visible,
            pos: {
              x: obj.position.x.toFixed(2),
              y: obj.position.y.toFixed(2),
              z: obj.position.z.toFixed(2),
            },
            worldPos: (() => {
              try {
                const wp = { x: 0, y: 0, z: 0 };
                obj.getWorldPosition(wp);
                return { x: wp.x.toFixed(2), y: wp.y.toFixed(2), z: wp.z.toFixed(2) };
              } catch { return { x: '?', y: '?', z: '?' }; }
            })(),
            parentType: obj.parent?.type,
            parentVisible: obj.parent?.visible,
          });
        }
      });

      return {
        totalObjects: allObjects.length,
        meshCount: meshes.length,
        objectTypeCounts: allObjects.reduce((acc: any, o: any) => {
          acc[o.type] = (acc[o.type] || 0) + 1;
          return acc;
        }, {}),
        meshes: meshes.slice(0, 30), // limit output
      };
    });
  };

  const scene1 = await inspectScene(page1, 'Page1');
  const scene2 = await inspectScene(page2, 'Page2');

  console.log('=== Page 1 Scene ===');
  console.log(JSON.stringify(scene1, null, 2));
  console.log('=== Page 2 Scene ===');
  console.log(JSON.stringify(scene2, null, 2));

  // Print relevant console logs filtered for our debug output
  console.log('=== Page 1 Remote Logs ===');
  logs1.filter(l => l.includes('[Remote')).forEach(l => console.log(l));
  console.log('=== Page 2 Remote Logs ===');
  logs2.filter(l => l.includes('[Remote')).forEach(l => console.log(l));

  // Print last 15 logs for context
  console.log('=== Page 1 Last 15 Logs ===');
  logs1.slice(-15).forEach(l => console.log(l));
  console.log('=== Page 2 Last 15 Logs ===');
  logs2.slice(-15).forEach(l => console.log(l));

  await ctx1.close();
  await ctx2.close();
});
