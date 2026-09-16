# todo.md

- [ ] 12 - Register repos/todo-md/apps/* in lemol-workspace
  #web

## Hub and sources

Multi-project support: the hub library, projects, sync, and git and Jira
sources. Design: [hub design](../docs/superpowers/specs/2026-09-13-hub-design.md).

- [ ] [13 - Make add and remove store capabilities](./hub-and-sources/13-make-add-and-remove-store-capabilities.md)
- [ ] [18 - Add the web dashboard and project management](./hub-and-sources/18-add-the-web-dashboard-and-project-management.md)
- [ ] [19 - Add the git source](./hub-and-sources/19-add-the-git-source.md)
- [ ] [06 - Add the Jira source](./hub-and-sources/06-add-the-jira-source.md)

## Release

## Later

- [ ] [20 - Build a TUI over the hub](./later/20-build-a-tui-over-the-hub.md)
- [ ] 09 - Build the hosted GitHub-backed web app
  #web depends_on:17,19
  Host the web app for use away from this machine. It builds on the hub (task 17) and the git source (task 19): a server whose projects are git clones. This task covers only hosting, authentication and multi-user concerns.
