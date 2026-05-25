/**
 * 生成唯一标识符
 *
 * @export
 * @returns
 */
export function guid(short = false) {
  const split = short ? '' : '-'
  return s4() + s4() + split + s4() + split + s4() + split + s4() + split + s4() + s4() + s4()
}

function s4() {
  return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)
}
