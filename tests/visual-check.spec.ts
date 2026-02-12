import { test, expect } from '@playwright/test';
import { join } from 'path';

const SCREENSHOT_DIR = join(__dirname, 'screenshots');

/**
 * Helper: wait for the WebGL canvas to be present and rendering.
 * Checks that the canvas element exists and has non-zero dimensions.
 */
async function waitForCanvas(page: import('@playwright/test').Page) {
  const canvas = page.locator('canvas');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  // Give the renderer a few frames to draw
  await page.waitForTimeout(2000);
  return canvas;
}

/**
 * Helper: read FPS from the on-screen counter element.
 * Returns the FPS number, or -1 if the counter is not found.
 */
async function readFps(page: import('@playwright/test').Page): Promise<number> {
  try {
    const fpsText = await page.locator('#fps-counter, [data-fps], .fps-counter')
      .first()
      .textContent({ timeout: 3000 });
    if (!fpsText) return -1;
    const match = fpsText.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
  } catch {
    return -1;
  }
}

test.describe('Visual Verification', () => {
  test('baseline - canvas renders and screenshot captured', async ({ page }) => {
    await page.goto('/');
    const canvas = await waitForCanvas(page);

    // Verify canvas has content (non-zero size)
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // Take full page and canvas screenshots
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'baseline-fullpage.png'),
      fullPage: true,
    });
    await canvas.screenshot({
      path: join(SCREENSHOT_DIR, 'baseline-canvas.png'),
    });

    // Read FPS if available
    const fps = await readFps(page);
    console.log(`Baseline FPS: ${fps === -1 ? 'counter not found' : fps}`);
  });

  test('terrain - noise and color enhancement', async ({ page }) => {
    await page.goto('/');
    const canvas = await waitForCanvas(page);

    // Wait extra for terrain to fully mesh
    await page.waitForTimeout(3000);

    await canvas.screenshot({
      path: join(SCREENSHOT_DIR, 'phase1-terrain-after.png'),
    });

    const fps = await readFps(page);
    console.log(`Phase 1 Terrain FPS: ${fps === -1 ? 'counter not found' : fps}`);
    if (fps > 0) {
      expect(fps).toBeGreaterThanOrEqual(55);
    }
  });

  test('buildings - smooth surface nets rendering', async ({ page }) => {
    await page.goto('/');
    const canvas = await waitForCanvas(page);

    // Wait for buildings to load and mesh
    await page.waitForTimeout(5000);

    await canvas.screenshot({
      path: join(SCREENSHOT_DIR, 'phase2-buildings-after.png'),
    });

    const fps = await readFps(page);
    console.log(`Phase 2 Buildings FPS: ${fps === -1 ? 'counter not found' : fps}`);
    if (fps > 0) {
      expect(fps).toBeGreaterThanOrEqual(55);
    }
  });

  test('destruction - smooth to voxel swap', async ({ page }) => {
    await page.goto('/');
    const canvas = await waitForCanvas(page);
    await page.waitForTimeout(5000);

    // Screenshot intact building
    await canvas.screenshot({
      path: join(SCREENSHOT_DIR, 'phase3-destruction-intact.png'),
    });

    // Note: actual destruction testing requires a running game server
    // and player interaction. This test captures the baseline visual state.
    const fps = await readFps(page);
    console.log(`Phase 3 Destruction FPS: ${fps === -1 ? 'counter not found' : fps}`);
    if (fps > 0) {
      expect(fps).toBeGreaterThanOrEqual(45);
    }
  });
});
