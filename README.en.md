# dsh-conversation-tools

English | [中文](README.md)

Add **exchange stars** and **sent-message editing** to DeepSeek Harness. Edit any human message, including the first, continue from that point, and keep the original answers and later conversation available as previous versions.

This is an independently installable plugin. It does not require modifying or rebuilding Harness, replace its message renderers, or add another branch button.

![Stars beside Copy and on the turn rail](docs/images/stars.png)

## Install

Tested with **DSH `0.2.2-rc.1`**. This early release does not claim compatibility with other host versions.

Paste this source into the app's Add plugin dialog:

```text
github:Hai-Story/dsh-conversation-tools#v0.1.0
```

Or install into the Web profile:

```sh
dsh plugin --profile web add "github:Hai-Story/dsh-conversation-tools#v0.1.0"
```

Restart DSH after installation. Each release commits `dist/`, so installing from GitHub requires no build scripts.

For the official desktop app, use its plugin UI or its bundled `dsh` command with the `desktop` profile. The Web profile is separate. Automated browser tests cover the stock npm Web distribution; Electron installation has not been independently tested.

## Use

Click the star beside Copy to bookmark the whole exchange. Both human and assistant controls, the turn rail, and its hover preview reflect the same saved state. Click again to remove it.

Click Edit beside a sent human message, change its text, then choose **Save and regenerate**. Existing attachments remain. Earlier context is retained; the replaced answer and subsequent conversation are excluded from the new request. Saving opens the new version; the header's version selector restores the full original conversation.

![Inline message editor](docs/images/edit.png)

Stop generation before editing. Editing changes conversation history only: it **does not undo file changes, commands, or other tool effects**.

## Compatibility and implementation

The package exposes a Cordis bundle and generated Remote descriptors. Assistant actions and the version selector use existing slots. Since stock DSH has no user-action or rail-decoration slots, a session-scoped DOM adapter portals plugin-owned React controls beside the existing Copy button and into rail marks.

It addresses `data-conversation-session`, `data-chat-node-key`, `data-clock`, and rail `data-index`. Message identities come from the Chat projection, never DOM text. Disposal removes only plugin-owned mounts and styles. This adapter depends on the tested host's DOM structure and must be revalidated for host upgrades.

The service reuses existing `session/fork` and `session/create` operations. Stars and version relationships use the `conversation_tools` storage domain; original logs are never overwritten. Versions are separate Sessions in the same workspace and may appear in the ordinary list. They preserve the current working directory and model selection.

Limits: text edits only, attachments cannot be added or removed; other browser clients reconcile annotations on reload/reconnect; the host's rail remains hidden for single-turn conversations. English and Simplified Chinese UI copy are included.

## Development

Requires Node.js 24.9+ and pnpm 11.28.5.

```sh
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run verify:dist
pnpm exec playwright install chromium
pnpm run test:browser
```

The browser test installs into an isolated profile and starts the published npm DSH, substituting only the external model with a keyless fixture. It checks stars, first-message editing, future-context exclusion, preserved versions, reload, and narrow/dark layouts. Temporary state stays in ignored `.artifacts/`.

Remote interface changes require updating types and descriptors in `src/protocol/` together and exercising the end-to-end calls. Rebuild and commit `dist/` before release; CI checks that artifacts match the source.

## References and license

Packaging conventions were informed by [dsh-context](https://github.com/bowenliang123/dsh-context) and [dsh-nested-followups](https://github.com/sluminositys/dsh-nested-followups). Host interfaces come from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
