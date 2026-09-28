---
title: Refuse comment bodies containing unescaped headings
---
Writing a comment whose body contains depth-3 headings outside code fences produces a file that todo-md's reader parses into multiple comments, failing check diagnostics. Even worse, depth-2 headings (ATX `## ` or setext `---` underlines) alter the file layout by replacing the `Comments` section, silently erasing all comments and folding them into the task description. `todo.comment` should refuse comment bodies containing unescaped depth-2 or depth-3 headings with a ValidationError rather than silently splitting them or destroying the layout.
