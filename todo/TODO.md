# todo.md

- [ ] 10 - Add move, reorder, remove, and group management to the web app
  #web
- [ ] 11 - Add a todo web command to the published package
  #web
- [ ] 12 - Register repos/todo-md/apps/* in lemol-workspace
  #web

## Hub and sources

Multi-project support: the hub library, projects, sync, and git and Jira
sources. Design: [hub design](../docs/superpowers/specs/2026-09-13-hub-design.md).

- [ ] [13 - Make add and remove store capabilities](./hub-and-sources/13-make-add-and-remove-store-capabilities.md)
- [ ] [14 - Build the hub: registry, resolution and project services](./hub-and-sources/14-build-the-hub-registry-resolution-and-project-services.md)
- [ ] [15 - Add sync, status, changes and overview to the hub](./hub-and-sources/15-add-sync-status-changes-and-overview-to-the-hub.md)
- [ ] [16 - Run the CLI on the hub with projects and sync commands](./hub-and-sources/16-run-the-cli-on-the-hub-with-projects-and-sync-commands.md)
- [ ] [17 - Run the web app on the hub](./hub-and-sources/17-run-the-web-app-on-the-hub.md)
- [ ] [18 - Add the web dashboard and project management](./hub-and-sources/18-add-the-web-dashboard-and-project-management.md)
- [ ] [19 - Add the git source](./hub-and-sources/19-add-the-git-source.md)
- [ ] [06 - Add the Jira source](./hub-and-sources/06-add-the-jira-source.md)

## Release

## Later

- [ ] [20 - Build a TUI over the hub](./later/20-build-a-tui-over-the-hub.md)
- [ ] 09 - Build the hosted GitHub-backed web app
  #web depends_on:17,19
  Host the web app for use away from this machine. It builds on the hub (task 17) and the git source (task 19): a server whose projects are git clones. This task covers only hosting, authentication and multi-user concerns.
