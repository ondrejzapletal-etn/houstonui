/**
 * Salvage a JSON document from an LLM reply.
 *
 * OpenAI's `response_format: json_object` guarantees bare JSON; Anthropic has no
 * equivalent, and Haiku wraps its answer in a ```json fence often enough to break
 * a naive JSON.parse (verified against the live API). Applied to both providers
 * so the three JSON.parse call sites get the same guarantee either way.
 *
 * Returns the input unchanged when nothing JSON-shaped is found – let the caller's
 * JSON.parse produce the error, with the original text in the message.
 */
export function extractJson(text: string): string {
  let out = text.trim()

  // ```json … ```  /  ``` … ```
  const fence = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?\s*```$/.exec(out)
  if (fence) out = fence[1].trim()

  if (out.startsWith('{') || out.startsWith('[')) return escapeControlCharactersInStrings(out)

  // Prose before/after the payload: take the outermost {...} or [...].
  const objStart = out.indexOf('{')
  const arrStart = out.indexOf('[')
  const start =
    objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart)
  if (start === -1) return text

  const closer = out[start] === '{' ? '}' : ']'
  const end = out.lastIndexOf(closer)
  if (end <= start) return text

  return escapeControlCharactersInStrings(out.slice(start, end + 1))
}

function escapeControlCharactersInStrings(json: string): string {
  let result = ''
  let insideString = false
  let escaped = false

  for (const character of json) {
    if (escaped) {
      result += character
      escaped = false
      continue
    }

    if (character === '\\') {
      result += character
      escaped = true
      continue
    }

    if (character === '"') {
      result += character
      insideString = !insideString
      continue
    }

    if (insideString && character.charCodeAt(0) < 0x20) {
      result += JSON.stringify(character).slice(1, -1)
      continue
    }

    result += character
  }

  return result
}
