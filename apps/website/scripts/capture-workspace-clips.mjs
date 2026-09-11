import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { setupWorkspaceCapture } from './workspace-capture-setup.mjs';

const origin = process.env.JACKALOPE_CAPTURE_ORIGIN ?? 'http://127.0.0.1:5197';
const output = fileURLToPath(new URL('../public/media/workspace/', import.meta.url));
const scratch = fileURLToPath(
  new URL('../../../output/playwright/workspace-clips/', import.meta.url),
);
const fps = 12;
const scenes = ['tasks', 'review', 'agents', 'context', 'recurring'];
const timestamp = (frame) => new Date((frame / fps) * 1000).toISOString().slice(11, 23);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const dark of [true, false]) {
    for (const scene of scenes) {
      if (process.env.JACKALOPE_CAPTURE_SCENE && process.env.JACKALOPE_CAPTURE_SCENE !== scene)
        continue;
      const name = `${scene}${dark ? '' : '-light'}`;
      const frames = `${scratch}/${name}-${Date.now()}`;
      mkdirSync(frames, { recursive: true });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 840 },
        reducedMotion: 'reduce',
      });
      try {
        await page.goto(origin);
        await setupWorkspaceCapture(page, dark);
        if (scene === 'agents') {
          await page.getByRole('button', { name: 'Agents', exact: true }).click();
          await page.getByRole('heading', { name: 'Agents', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Manage 2 Codex accounts' }).waitFor();
        } else if (scene === 'context') {
          await page.getByRole('button', { name: 'Project', exact: true }).click();
          await page.getByRole('button', { name: 'Context', exact: true }).click();
          await page.getByRole('heading', { name: 'Project context', exact: true }).waitFor();
        } else if (scene === 'recurring') {
          await page.getByRole('button', { name: 'Recurring', exact: true }).click();
          await page
            .getByRole('heading', { name: 'Weekly dependency review', exact: true })
            .waitFor();
        } else {
          await page
            .getByRole('navigation', { name: 'tasks views', exact: true })
            .getByRole('button', { name: 'Inbox', exact: true })
            .click();
          await page.getByRole('button', { name: 'Board', exact: true }).click();
        }
        await page.waitForTimeout(600);
        await page.evaluate(async () => {
          const { useCompanionStore } = await import('/src/stores/companionStore.ts');
          useCompanionStore.setState({ sources: {} });
        });
        await page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 88 });
        let frame = 0;
        let recording = true;
        const chapters = [
          {
            frame: 0,
            text: 'Jackalope · fictional Atlas sample project. No native tasks are launched.',
          },
        ];
        const capture = (async () => {
          while (recording) {
            const start = Date.now();
            await page.screenshot({
              path: `${frames}/${String(frame++).padStart(5, '0')}.jpg`,
              type: 'jpeg',
              quality: 88,
            });
            await new Promise((resolve) =>
              setTimeout(resolve, Math.max(0, 1000 / fps - (Date.now() - start))),
            );
          }
        })();
        const chapter = (text) => chapters.push({ frame, text });
        const hold = async () => {
          const until = frame + fps * 2;
          while (frame < until) await page.waitForTimeout(50);
        };
        try {
          await hold();
          if (scene === 'tasks') {
            chapter('Switch between the task board and a compact list.');
            await page.getByRole('button', { name: 'List', exact: true }).click();
            await hold();
            chapter('Draft the next task in your project. Choose an agent before starting.');
            const composer = page.getByRole('textbox', {
              name: 'What do you want to accomplish?',
              exact: true,
            });
            await composer.scrollIntoViewIfNeeded();
            await composer.pressSequentially('Make search feel great from the keyboard.', {
              delay: 45,
            });
            await hold();
          } else if (scene === 'review') {
            chapter('Open a result alongside its original task.');
            await page.getByRole('button', { name: /^Improve the search experience/ }).click();
            await page.getByText('Changes & checks', { exact: true }).waitFor();
            await hold();
            chapter('Inspect the changes and the checks recorded for this sample task.');
            await page.getByText('Changes & checks', { exact: true }).click();
            await page.locator('.task-patch > summary').click();
            await page.getByRole('button', { name: 'Original patch', exact: true }).click();
            await page
              .locator('.task-patch')
              .evaluate((element) =>
                element.scrollIntoView({ block: 'center', behavior: 'smooth' }),
              );
            await hold();
            await page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 88 });
          } else if (scene === 'agents') {
            chapter('Keep your work and personal sign-ins organized by account.');
            await page.getByRole('button', { name: 'Manage 2 Codex accounts' }).click();
            await page.getByRole('heading', { name: 'Configure Codex', exact: true }).waitFor();
            await page
              .getByRole('region', { name: 'Agent accounts', exact: true })
              .scrollIntoViewIfNeeded();
            await hold();
            chapter('Inspect the account groups and sign-in status available to your projects.');
            await hold();
          } else if (scene === 'context') {
            chapter('Project instructions, source files, and local check commands stay together.');
            await hold();
            chapter('Read an editable lesson and a reusable workflow for future tasks.');
            await page
              .getByRole('heading', { name: 'Lessons and workflows', exact: true })
              .evaluate((element) =>
                element.scrollIntoView({ block: 'start', behavior: 'smooth' }),
              );
            await page
              .getByRole('button', { name: 'Read full content', exact: true })
              .first()
              .click();
            await hold();
          } else {
            chapter('Browse paused schedules and local change monitors.');
            await page.locator('.schedule-list article').first().locator('summary').click();
            await hold();
            chapter('Inspect the prompt and timing before enabling a schedule.');
            await page
              .locator('.schedule-list article')
              .first()
              .getByRole('button', { name: 'Edit', exact: true })
              .click();
            await page.getByRole('dialog').waitFor();
            await hold();
          }
        } finally {
          recording = false;
          await capture;
        }
        const result = spawnSync(
          'ffmpeg',
          [
            '-y',
            '-loglevel',
            'error',
            '-framerate',
            String(fps),
            '-i',
            `${frames}/%05d.jpg`,
            '-c:v',
            'libx264',
            '-preset',
            'medium',
            '-threads',
            '2',
            '-crf',
            '24',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
            '-an',
            `${output}/${name}.mp4`,
          ],
          { windowsHide: true, stdio: 'inherit' },
        );
        if (result.error || result.status !== 0)
          throw result.error ?? new Error('Video encoding failed');
        const captions = chapters
          .map(
            (chapter, index) =>
              `${timestamp(chapter.frame)} --> ${timestamp(chapters[index + 1]?.frame ?? frame)}\n${chapter.text}`,
          )
          .join('\n\n');
        writeFileSync(`${output}/${name}.vtt`, `WEBVTT\n\n${captions}\n`);
        console.log(`${name}: ${(frame / fps).toFixed(1)} seconds`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
