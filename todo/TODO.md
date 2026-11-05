# todo.md

- [ ] 74 - add writes an item it cannot read back when the description ends in a bare list marker
  #bug filed_by:01M6PBJ4EB815VYMX0ZTGVZGAB
  Evidence (from nzila:946, 2026-11-05): an nzila filing with the body "-" made todo-md's FsTodoStore `add` write the item inline:

  ```
  - [ ] 944 - A filing into a project with no list ...
    filed_by:01M6P5KQQNT9FJV9ETEE934FD2
    -
  ```

  The store then could not read it back: `todo show 944` says `no task 944`, and `usedIds` leaves 944 out. So the next `add` took 944 again. In nzila's list, that closed a new, unworked task as done (nzila commit 8af25d1b2, repaired by hand in 870bb9194).

  Repro, in any list:

  ```
  printf '%s' 'x
  -' | todo add "probe title" --no-group --description -
  # error: no task <id>   (the item is already written to TODO.md)
  ```

  The description `-` alone fails the same way. Bodies `- x`, `*`, `+`, `1.` and `#` go to a task file and read back fine. Only the inline form breaks.

  Fix: `add` (and `update`) must never write an item the parser cannot read back. Either escape or indent a description line that is a bare list marker, or put such a description in a task file, or refuse it with a ValidationError. Whatever is chosen, an id that is written must count in `usedIds`, so `nextId` never hands it out twice.

  Tests: add with the description `-`, and with `x\n-`; then `show` finds the task, its description round-trips (or the add is refused), and a second add takes the next id.



## Hub and sources

Multi-project support: the hub library, projects, sync, and git and Jira
sources. Design: [hub design](../docs/superpowers/specs/2026-09-13-hub-design.md).


## Release




## Later




## M3 — @lemol/ui adoption

## Read cost







