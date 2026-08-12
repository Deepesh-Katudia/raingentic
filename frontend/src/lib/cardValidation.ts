export function luhnCheck(digits: string): boolean {
  let sum = 0
  let alternate = false

  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (alternate) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alternate = !alternate
  }

  return sum % 10 === 0
}

export function isCardNumberValid(raw: string): boolean {
  const digits = raw.replace(/\s+/g, '')
  return /^\d{13,19}$/.test(digits) && luhnCheck(digits)
}

export function isExpiryValid(raw: string): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(raw.trim())
  if (!match) return false

  const month = Number(match[1])
  const year = 2000 + Number(match[2])
  if (month < 1 || month > 12) return false

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  if (year < currentYear) return false
  if (year === currentYear && month < currentMonth) return false
  return true
}

export function isCvcValid(raw: string): boolean {
  return /^\d{3,4}$/.test(raw.trim())
}

export function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 19)
  return digits.replace(/(.{4})/g, '$1 ').trim()
}

export function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}
