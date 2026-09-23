# Knowledgebase content and media

Guide text lives in `packages/knowledge/src/content.ts`. Keep each guide focused
on a user outcome: explain prerequisites, the action, how to check it, and the
next step when it fails. Prefer a short useful answer to a word-count target.
Link to dedicated troubleshooting steps instead of repeating them in overview
guides. Preserve section IDs when editing so existing links continue to work.

The website renders ordered steps and related links from the same source used
by copied Markdown, `/knowledge/<slug>/index.md`, `llms-full.txt`, and bundled
native help. Run `node scripts/knowledge.mjs` after content edits to refresh
`packages/knowledge/catalog.json`; `pnpm verify` checks that it is current.

## Visuals

`apps/website/src/knowledge-media.ts` assigns each visual to its guide and section.
Only add a visual when it explains the adjacent task. Text must remain useful
without the media. Screenshots open at their original size and use the matching
light/dark sample workspace image. Clips have native controls, captions, a
written walkthrough and a direct video link; they do not autoplay or preload
video data.

Website players initialize at 25% volume when media loads. Visitors can adjust
volume through the native controls; seeking and chapter changes keep that choice.

The clips are silent excerpts from the existing
`apps/website/public/media/launch-v4-720p.mp4` sample-data tour:

| Clip | Source interval | Poster frame | Guide |
| --- | --- | --- | --- |
| composer | 25–32 seconds | 29 seconds | First task |
| accounts | 45–51 seconds | 48 seconds | Agents and accounts |
| browser | 34–43 seconds | 40 seconds | Tools and browser |
| theme | 6–12 seconds | 8 seconds | Appearance |

Files live in `apps/website/public/media/knowledge/`. MP4s use H.264, yuv420p,
CRF 24, no audio, and fast-start metadata. Posters are original video frames;
English WebVTT cues are relative to each excerpt. The four videos total about
605 KB; posters add about 200 KB. Existing `review[-light].png` and
`tasks[-light].png` illustrate task review and history navigation.

These are recorded frontend examples with fictional Atlas data. The browser
sequence is scripted. They do not establish provider authentication, real
bookings, native task execution, or installed-app acceptance. Keep that context
in the captions and walkthroughs. Do not use this footage to illustrate native
Windows control or helper actions that it does not show.

## Product tour

`TourPage.tsx` presents the launch film with click-to-play chapter shortcuts,
native controls, English captions, a transcript and a direct-video fallback.
Its workflow explorer reuses the context, tasks and review workspace clips below,
including their light/dark captures. Film and clip data load only after a play
action. Keep chapter times aligned with `launch-v4.vtt` when replacing the film.

## Feature-page media

`apps/website/src/feature-media.ts` maps feature, agent and workflow pages to
their relevant captures and article sections. `FeatureMedia.tsx` reuses the
browser, composer and accounts clips above without duplicating video files.
Clips remain click-to-play with captions, written walkthroughs, direct links
and an error fallback. Screenshot pages use larger, full-size-linked images
and switch captures with the website's light/dark control.

The recurring screenshots are captures of the actual
`ScheduleManager` frontend with two fictional, paused Atlas schedules. They
show no execution history. To regenerate both appearances, start the desktop
Vite preview on port 5193 and run:

```powershell
node apps/website/scripts/capture-feature-media.mjs
```

Set `JACKALOPE_CAPTURE_ORIGIN` to use a different preview URL. The script uses
an isolated Edge browser context and the existing sample IPC fixture; it does
not access a native profile or start a scheduled task. The capture bounds show
the heading and schedule list, excluding unrelated workspace notifications.

## Landing-page workspace clips

The workspace explorer uses focused recordings of Tasks, Changes & review,
Agents & accounts, Project context and Recurring tasks. `WorkspaceClip.tsx` loads
each video only after a play click, with native controls, English captions,
an accessible written description and a direct-link fallback on playback failure.
Changing the view or appearance resets playback. No captions or labels sit beneath
the preview.

To regenerate the light and dark clips from the current desktop frontend, start
its Vite preview on port 5197 and run:

```powershell
node apps/website/scripts/capture-workspace-clips.mjs
```

The capture requires Edge and FFmpeg on PATH. Set `JACKALOPE_CAPTURE_ORIGIN` for
another preview URL, or `JACKALOPE_CAPTURE_SCENE` to regenerate one of `tasks`,
`review`, `agents`, `context` or `recurring`. Outputs are H.264 MP4s, JPEG posters
and timed WebVTT captions in `apps/website/public/media/workspace/`; intermediate
frames stay in ignored `output/playwright/workspace-clips/`.

`workspace-capture-setup.mjs` extends the isolated Atlas browser fixture with
sample accounts, saved knowledge and paused schedules. It blocks task launch and
schedule saves. The clips show frontend interactions with fictional data, not
provider authentication, native execution or installed-app acceptance.

## Verification

The website build checks local page links, anchors, linked files, and embedded
image/video/poster/caption files. With a production preview running, use
`pnpm check:links:website --origin http://127.0.0.1:<port>` to check its internal
destinations and live external sources. Without `--origin`, the audit checks
the public site. A local preview does not establish deployment acceptance.

Check light/dark and narrow layouts; search, clear-search focus, category
selection, table-of-contents links, copy feedback, screenshot links, playback,
captions, and text fallbacks. Read each linked page to confirm the label and
claim match its contents. HTTP 200 alone is insufficient.
