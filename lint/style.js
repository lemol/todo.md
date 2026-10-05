// Local lint rules for layout the stock oxlint rules cannot express.

const isFunction = (node) =>
  node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression"

// A run of single-line consts reads as one group only while its members are
// the same kind: values, or functions.
const kindOf = (statement) => {
  if (statement.type !== "VariableDeclaration" || statement.kind !== "const") return undefined

  const init = statement.declarations.at(-1)?.init

  return init !== undefined && init !== null && isFunction(init) ? "function" : "value"
}

const constGroups = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    messages: { separate: "Separate value consts from function consts with a blank line." },
  },
  create(context) {
    const source = context.sourceCode

    const check = (body) => {
      for (let i = 1; i < body.length; i++) {
        const prev = body[i - 1]
        const next = body[i]
        const before = kindOf(prev)
        const after = kindOf(next)

        if (before === undefined || after === undefined || before === after) continue

        const first = source.getTokenAfter(prev, { includeComments: true })

        if (first.loc.start.line - prev.loc.end.line > 1) continue

        let last = prev

        for (
          let token = source.getTokenAfter(prev, { includeComments: true });
          token !== null && token.loc.start.line === prev.loc.end.line;
          token = source.getTokenAfter(token, { includeComments: true })
        ) {
          last = token
        }

        context.report({
          node: next,
          messageId: "separate",
          fix: (fixer) => fixer.insertTextAfter(last, "\n"),
        })
      }
    }

    return {
      Program: (node) => check(node.body),
      BlockStatement: (node) => check(node.body),
      StaticBlock: (node) => check(node.body),
      SwitchCase: (node) => check(node.consequent),
    }
  },
}

export default {
  meta: { name: "local" },
  rules: { "const-groups": constGroups },
}
