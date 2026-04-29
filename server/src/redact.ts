export function redactPhone(phone: string): string {
  if (!phone) return '';
  if (phone.length <= 4) return phone;
  const last4 = phone.slice(-4);
  const prefix = phone.slice(0, -4);
  let out = '';
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (ch === '+' || /[0-9]/.test(ch)) {
      out += i <= 2 ? ch : '*';
    } else {
      out += ch;
    }
  }
  return out + last4;
}
