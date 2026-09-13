export const TaskRow = (html: string) => () => html
export const BoardPage = (html: string) => () => html
export const AddTaskForm = (action: string) =>
  `<form method="post" action="${action}"><label>Title <input name="title" required></label><button>Add task</button></form>`
