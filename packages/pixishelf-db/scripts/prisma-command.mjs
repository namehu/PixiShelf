const DATABASE_INDEPENDENT_COMMANDS = new Set(['generate'])

export function prismaCommandRequiresDatabaseUrl(arguments_) {
  const command = arguments_[0]
  return command === undefined || !DATABASE_INDEPENDENT_COMMANDS.has(command)
}
