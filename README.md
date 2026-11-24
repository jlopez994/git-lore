# Git Lore

Free and open-source Git superpowers for VS Code: blame, file and line history, a visual file history, revision
navigation, a commit graph you can work from (branches, checkout, merge, cherry-pick, stash…) and branch comparison.
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
- **Contributors.** A *Contributors* view in the Source Control panel lists everyone who committed to the current
  branch, by number of commits. Expand a person to see their commits; click one for its files and diffs.
- **Visual file history.** `Show Visual File History` (editor context menu, Explorer, or the icon in the File History
  view) puts every commit to a file on a timeline: one row per author, dots sized by the lines changed, and added and
  deleted lines underneath. Hover a dot for the commit, click it for its diff, or move between commits with the arrow
  keys. Hover an author to highlight their commits.
- **Revision navigation.** The ← and → buttons in the editor title step through the commits that changed the file,
  each as a diff; → from the newest commit returns to the working file.
- **Commit graph.** `Show Commit Graph` (the Graph button in the status bar, or the merge icon in the Source Control
  title) draws every branch, local and remote, in a full editor tab, in the spirit of Git Graph.
  - *Reading it:* colored lanes, with branch and tag badges in the color of their lane (local branches filled, remote
    ones tinted, tags neutral). Hover a message, author or badge for the full text. A row above HEAD shows your
    uncommitted changes. Choose all branches, local branches or the current branch, filter by message, author, ref or
    SHA, and scroll to load more. Drag the graph's edge to make it wider (double-click to reset).
  - *Commit details:* click a commit (or press Enter; arrows move between rows) to open its message, author, parents and
    changed files inline. Each file opens its diff; right-click it to open it at that revision, compare it with the
    working file, open the working file, copy its path or restore it to that revision.
  - *Working from it:* right-click a commit (or Shift+F10) to create a branch or tag on it, check it out, cherry-pick
    it, revert it or reset the current branch to it. Right-click a badge to check out, merge into the current branch or
    delete it; checking out a remote branch creates the local branch that tracks it. The toolbar button fetches from
    all remotes. Deleting and `reset --hard` ask first.
  - *Stashes and worktrees:* stashes are rows on the commit they were made on (apply, pop or drop them from their
    menu). Branches checked out in another worktree carry a folder icon, a detached worktree gets its own badge, and
    you can open any of them in a new window.
  - *Always current:* it redraws by itself when HEAD, your uncommitted files or any branch, tag or stash changes,
    including fetches, pushes and branches made from the terminal. Turn on VS Code's `git.autofetch` to keep remote
    branches fresh in the background.

  Works the same on public and private repositories.
- **Compare.** `Compare Branches or Refs…` (the compare icon in the Source Control title) lists the files that differ
  between two branches, tags or commits (you can type any SHA), or between a ref and your working tree. Click a file for its diff; swap the sides from the view title.

Everything is localized in English and Spanish.

## Settings

| Setting | Default | |
|---|---|---|
| `gitLore.currentLine.enabled` | `true` | Show the blame of the current line. Also `Git Lore: Toggle Current Line Blame`. |

The colors are themeable: `gitLore.currentLineForeground`, `gitLore.fileBlameForeground`, `gitLore.fileBlameBackground`.

For a commit graph that keeps remote branches fresh, enable VS Code's `git.autofetch` (and `git.autofetchPeriod`).

If you also enable VS Code's own blame (`git.blame.editorDecoration.enabled`), you will see the blame twice; keep one.

## Requirements

The built-in Git extension (it ships with VS Code). Git Lore uses the same `git` binary and repositories it has found.
It works in local folders and remote workspaces (SSH, WSL, containers).

## How it works

Git Lore runs `git` in your repository with the binary of the built-in Git extension. On its own it only reads (`blame`,
`log`, `show`, `diff`, `for-each-ref`, `stash list`, `worktree list`). It only changes your repository when you pick an
action in the commit graph (checkout, branch, tag, merge, cherry-pick, revert, reset, stash, restore a file, fetch),
and the destructive ones ask first. It sends nothing anywhere and has no telemetry.

## Contributing

Issues and pull requests are welcome at <https://github.com/jlopez994/git-lore>. Run the tests with `npm test`.

Git Lore is an independent project. It is not affiliated with GitKraken or GitLens, and contains no code from them.
