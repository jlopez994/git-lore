# Git Lore

Free and open-source Git superpowers for VS Code: blame, file and line history, a commit graph and branch comparison.
No account, no sign-in, no trial, no paywall, no telemetry. MIT licensed.

![Git Lore](images/icon.png)

## Features

- **Current line blame.** Who changed the line under the cursor, when and why, at the end of the line. Hover it for the
  full commit message and quick actions: open the changes of that commit, show all its files, copy the SHA, open it on
  GitHub, GitLab, Bitbucket or Azure DevOps, or jump to the line history. Unsaved edits are taken into account, so lines
  never drift.
- **File blame.** `Git Lore: Toggle File Blame` (the person icon in the editor title) adds a column with the commit of
  each block of lines and a heat map: orange for recent changes, blue for old ones.
- **File history and line history.** A *File History* view in the Source Control panel follows the active editor and
  lists every commit that touched the file, renames included. Select some lines and run `Show Line History` (editor
  context menu) to see only the commits that changed them. Click a commit to open its diff.
- **Commit graph.** `Show Commit Graph` (the merge icon in the Source Control title) draws every branch, local and remote,
  with branch and tag badges, in a full editor tab. Click a commit to open its details inline: full message, author,
  parents and the changed files, each one opening its diff. A row above HEAD shows your uncommitted changes, and you can
  show all branches, local branches only or the current branch. It loads more commits as you scroll and filters by
  message, author, ref or SHA. Works the same on public and private repositories.
- **Compare.** `Compare Branches or Refs…` (the compare icon in the Source Control title) lists the files that differ between two branches, tags or commits (you can
  type any SHA), or between a ref and your working tree. Click a file for its diff; swap the sides from the view title.

Everything is localized in English and Spanish.

## Settings

| Setting | Default | |
|---|---|---|
| `gitLore.currentLine.enabled` | `true` | Show the blame of the current line. Also `Git Lore: Toggle Current Line Blame`. |

The colors are themeable: `gitLore.currentLineForeground`, `gitLore.fileBlameForeground`, `gitLore.fileBlameBackground`.

If you also enable VS Code's own blame (`git.blame.editorDecoration.enabled`), you will see the blame twice; keep one.

## Requirements

The built-in Git extension (it ships with VS Code). Git Lore uses the same `git` binary and repositories it has found.
It works in local folders and remote workspaces (SSH, WSL, containers).

## How it works

Git Lore only runs read-only git commands (`blame`, `log`, `show`, `diff`, `for-each-ref`) in your repository. It never
changes your repository, sends nothing anywhere and has no telemetry.

## Contributing

Issues and pull requests are welcome at <https://github.com/jlopez994/git-lore>. Run the tests with `npm test`.

Git Lore is an independent project. It is not affiliated with GitKraken or GitLens, and contains no code from them.
