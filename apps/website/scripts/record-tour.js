async function _recordTour(page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 840 });
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'tasks views', exact: true })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  const allTasks = page.getByRole('button', { name: 'All tasks', exact: true });
  if (await allTasks.isVisible()) await allTasks.click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.id = 'tour-recording-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `<style>
      #tour-recording-overlay { position:fixed; inset:0; z-index:2147483647; pointer-events:none; }
      #tour-cursor { position:absolute; width:22px; height:28px; left:0; top:0; color:var(--color-accent); filter:drop-shadow(0 2px 3px var(--color-surface-sunken)); }
      #tour-cursor-ring { position:absolute; width:38px; height:38px; border:2px solid var(--color-accent); border-radius:50%; opacity:0; }
      #tour-caption { position:absolute; bottom:25px; right:28px; max-width:370px; border-radius:14px; padding:18px 22px; background:var(--color-surface-elevated); color:var(--color-text-primary); box-shadow:var(--shadow-pop); }
      #tour-caption small { display:block; font:500 10px/1.5 'Plus Jakarta Sans',sans-serif; letter-spacing:1px; color:var(--color-text-muted); margin-bottom:7px; }
      #tour-caption strong { display:block; font:600 18px/1.5 'Plus Jakarta Sans',sans-serif; }
      #tour-caption p { font:400 12px/1.6 'Plus Jakarta Sans',sans-serif; margin:5px 0 0; color:var(--color-text-secondary); }
    </style><svg id="tour-cursor" viewBox="0 0 24 30"><path fill="currentColor" stroke="var(--color-text-primary)" stroke-width="1.2" d="M2 2L21 16L12 17L8 26Z"/></svg><div id="tour-cursor-ring"></div><div id="tour-caption"><small>JACKALOPE · SAMPLE PROJECT</small><strong></strong><p></p></div>`;
    document.body.append(overlay);
    window.__tourMove = (event) => {
      document.getElementById('tour-cursor').style.transform =
        `translate(${event.clientX}px, ${event.clientY}px)`;
    };
    window.__tourClick = (event) => {
      const ring = document.getElementById('tour-cursor-ring');
      ring.style.left = `${event.clientX - 19}px`;
      ring.style.top = `${event.clientY - 19}px`;
      ring.animate(
        [
          { opacity: 0.8, transform: 'scale(0.45)' },
          { opacity: 0, transform: 'scale(1.4)' },
        ],
        { duration: 550, easing: 'ease-out' },
      );
    };
    document.addEventListener('pointermove', window.__tourMove);
    document.addEventListener('pointerdown', window.__tourClick);
  });
  let pointer = { x: 720, y: 650 };
  await page.mouse.move(pointer.x, pointer.y);
  const moveTo = async (target) => {
    const start = pointer;
    for (let step = 1; step <= 22; step++) {
      const progress = (1 - Math.cos((Math.PI * step) / 22)) / 2;
      await page.mouse.move(
        start.x + (target.x - start.x) * progress,
        start.y + (target.y - start.y) * progress,
      );
      await page.waitForTimeout(12);
    }
    pointer = target;
  };
  const click = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('Recording target is not visible');
    await moveTo({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(450);
  };
  const started = Date.now();
  const chapters = [];
  const chapter = async (title, description) => {
    chapters.push({ title, seconds: (Date.now() - started) / 1000 });
    await page.evaluate(
      ({ title, description }) => {
        const caption = document.getElementById('tour-caption');
        caption.querySelector('strong').textContent = title;
        caption.querySelector('p').textContent = description;
        caption.animate(
          [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 350, easing: 'ease-out' },
        );
      },
      { title, description },
    );
  };
  try {
    await chapter('See the whole story.', 'Ideas, active tasks, and review. Together.');
    await page.waitForTimeout(1400);
    await click(page.getByRole('button', { name: 'List', exact: true }));
    await page.waitForTimeout(900);
    await click(page.getByRole('button', { name: 'Board', exact: true }));

    await chapter(
      'Start with what you want to make.',
      'Describe the outcome. Choose who takes it on.',
    );
    await click(page.getByRole('button', { name: 'New task', exact: true }));
    const composer = page.getByRole('textbox', { name: 'What do you want to accomplish?' });
    await click(composer);
    await composer.press('ControlOrMeta+A');
    await composer.pressSequentially('Make search feel great from the keyboard.', { delay: 55 });
    await click(page.getByRole('combobox', { name: 'Agent', exact: true }));
    await click(page.getByRole('option', { name: 'Claude Code', exact: true }));
    await page.waitForTimeout(1100);
    await click(page.getByRole('button', { name: 'Close composer', exact: true }));

    await chapter('The work comes back to you.', 'Read the result. Inspect the patch and checks.');
    await click(page.getByRole('button', { name: /^Improve the search experience/ }));
    await page.waitForTimeout(900);
    await click(page.getByRole('button', { name: 'Inspect changes', exact: true }));
    await page
      .getByRole('main')
      .evaluate((main) => main.scrollBy({ top: 340, behavior: 'smooth' }));
    await page.waitForTimeout(800);
    await click(page.getByText('Read patch', { exact: true }));
    await page
      .getByText('Read patch', { exact: true })
      .evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await page.waitForTimeout(1800);

    await chapter(
      'Your agents. One place to work.',
      'Use your existing accounts and follow each task.',
    );
    await click(page.getByRole('button', { name: 'Agents', exact: true }));
    await page.waitForTimeout(1600);

    await chapter('Find your kind of calm.', 'A live palette. Light or dark. Entirely yours.');
    await click(page.getByRole('button', { name: 'Personalize your workspace' }));
    await click(page.getByRole('button', { name: 'Electric Indigo', exact: true }));
    const field = page.getByRole('slider', { name: 'Color field', exact: true });
    const box = await field.boundingBox();
    if (!box) throw new Error('Color field is not visible');
    await moveTo({ x: box.x + box.width * 0.65, y: box.y + box.height * 0.45 });
    await page.mouse.down();
    await moveTo({ x: box.x + box.width * 0.9, y: box.y + box.height * 0.3 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    await click(page.getByText('Light', { exact: true }));
    await click(page.getByRole('button', { name: 'Mojave Sunset', exact: true }));
    await click(page.getByRole('button', { name: 'Keep theme', exact: true }));
    await click(page.getByRole('button', { name: 'Tasks', exact: true }));
    if (await allTasks.isVisible()) await click(allTasks);
    await chapter('Make room for your next idea.', 'Your project. Your agents. Your final call.');
    await moveTo({ x: 1110, y: 650 });
    await page.waitForTimeout(1600);
    const launchedTasks = await page.evaluate(
      () => window.__auditCalls.filter((call) => call.command === 'task_start').length,
    );
    if (launchedTasks !== 0) throw new Error('A recording must not launch tasks');
    return { chapters, duration: (Date.now() - started) / 1000, launchedTasks };
  } finally {
    await page.evaluate(() => {
      document.removeEventListener('pointermove', window.__tourMove);
      document.removeEventListener('pointerdown', window.__tourClick);
      document.getElementById('tour-recording-overlay')?.remove();
      delete window.__tourMove;
      delete window.__tourClick;
    });
  }
}
