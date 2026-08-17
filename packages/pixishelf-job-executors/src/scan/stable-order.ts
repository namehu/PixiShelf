export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!)
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}

export function compareNaturalCodePoints(left: string, right: string): number {
  const leftParts = left.match(/\d+|\D+/g) ?? []
  const rightParts = right.match(/\d+|\D+/g) ?? []
  const length = Math.min(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index]!
    const rightPart = rightParts[index]!
    if (/^\d+$/.test(leftPart) && /^\d+$/.test(rightPart)) {
      const leftTrimmed = leftPart.replace(/^0+(?=\d)/, '')
      const rightTrimmed = rightPart.replace(/^0+(?=\d)/, '')
      if (leftTrimmed.length !== rightTrimmed.length) return leftTrimmed.length - rightTrimmed.length
      const numericOrder = compareCodePoints(leftTrimmed, rightTrimmed)
      if (numericOrder !== 0) return numericOrder
      if (leftPart.length !== rightPart.length) return leftPart.length - rightPart.length
      continue
    }
    const order = compareCodePoints(leftPart, rightPart)
    if (order !== 0) return order
  }
  return leftParts.length - rightParts.length
}
