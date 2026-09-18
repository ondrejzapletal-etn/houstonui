export interface GoogleDocsCommentNotification {
  documentId: string
  documentUrl?: string
  documentTitle: string
  mentionedEmails: string[]
  mentionsCurrentUser: boolean | null
  mentionsOtherUsers: boolean
  repliesToCurrentUser: boolean
  commentText: string
}

const GOOGLE_DOC_URL_RE = /https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)(?:\/[^\s<>]*)?/i
const MENTIONED_EMAIL_RE = /@([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)/g
const REPLY_TO_CURRENT_USER_PATTERNS = [
  /repl(?:ied|y) to your comment/i,
  /repl(?:ied|y) to a comment you (?:made|left)/i,
  /replied to (?:a|the) comment/i,
  /odpov(?:ě|e)d(?:ěl|ěla|ěli|el|ela|eli)? na váš komentář/i,
  /odpověď na váš komentář/i,
  /odpov(?:ě|e)d(?:ěl|ěla|ěli|el|ela|eli)? na komentář/i,
  /reagoval(?:a|i)? na váš komentář/i,
]

const COMMENT_SUBJECT_RE = /(?:comment|komentář|komentari|mentioned you|zmínil(?:a)? vás|označil(?:a)? vás)/i
const DECEPTIVE_DOCS_HOST_RE = /https:\/\/docs\.google\.com\.[^/\s]+/i

export function parseGoogleDocsCommentNotification(
  input: { from: string; subject: string; body: string; snippet: string },
  connectedEmail?: string,
): GoogleDocsCommentNotification | undefined {
  const content = `${input.subject}\n${input.body}\n${input.snippet}`
  const documentMatch = content.match(GOOGLE_DOC_URL_RE)
  if (!isPotentialGoogleDocsCommentNotification(input)) return undefined
  if (!documentMatch && DECEPTIVE_DOCS_HOST_RE.test(content)) return undefined

  const documentTitle = extractDocumentTitle(input.subject)
  const documentId = documentMatch?.[1] ?? `title-${normalizeTitle(documentTitle)}`
  const mentionedEmails = [...content.matchAll(MENTIONED_EMAIL_RE)]
    .map((match) => match[1].toLowerCase())
    .filter((email, index, values) => values.indexOf(email) === index)
  const normalizedConnectedEmail = connectedEmail?.trim().toLowerCase() || undefined
  const mentionsCurrentUser = normalizedConnectedEmail
    ? mentionedEmails.includes(normalizedConnectedEmail)
    : null

  return {
    documentId,
    documentUrl: documentMatch
      ? `https://docs.google.com/document/d/${documentId}`
      : undefined,
    documentTitle,
    mentionedEmails,
    mentionsCurrentUser,
    mentionsOtherUsers: normalizedConnectedEmail
      ? mentionedEmails.some((email) => email !== normalizedConnectedEmail)
      : mentionedEmails.length > 0,
    repliesToCurrentUser: REPLY_TO_CURRENT_USER_PATTERNS.some((pattern) => pattern.test(content)),
    commentText: (input.body || input.snippet).trim().slice(0, 2000),
  }
}

function isGoogleNotificationSender(from: string): boolean {
  const address = from.match(/<([^<>]+)>/)?.[1] ?? from
  const normalized = address.trim().toLowerCase()
  return normalized.endsWith('@docs.google.com') || normalized.endsWith('@google.com')
}

function extractDocumentTitle(subject: string): string {
  const quoted = subject.match(/["“”']([^"“”']+)["“”']/)?.[1]
  return (quoted ?? subject).trim().slice(0, 300) || 'Google dokument'
}

export function isPotentialGoogleDocsCommentNotification(input: {
  from: string
  subject: string
}): boolean {
  return isGoogleNotificationSender(input.from) && COMMENT_SUBJECT_RE.test(input.subject)
}

function normalizeTitle(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  return normalized || 'unknown-document'
}