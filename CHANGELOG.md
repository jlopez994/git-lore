# Changelog

## 0.2.0

- Commit graph: click a commit to open its details inside the graph (full message, author, parents and changed files;
  each file opens its diff). Escape or a second click closes it.
- Commit graph: an "Uncommitted changes" row above HEAD while the working tree has changes.
- Commit graph: choose all branches, local branches only or the current branch.
- Commit graph: refs from other tools (stash, notes, `refs/t3/…`) no longer show up.
- Fix: the commit graph filter now hides the rows that don't match.
- Compare References has its own icon in the Source Control title bar.

## 0.1.0

- Current line blame at the end of the line, with a hover: full message, open changes, copy SHA, open on
  GitHub/GitLab/Bitbucket/Azure DevOps and line history.
- File blame: a column with the commit of each block and a heat map from recent (orange) to old (blue).
- File history and line history in the Source Control panel, following renames; click a commit to see its diff.
- Commit graph of all branches, paged as you scroll, with filtering, branch and tag badges and copy SHA.
- Compare two branches, tags or commits, or a ref with the working tree.
