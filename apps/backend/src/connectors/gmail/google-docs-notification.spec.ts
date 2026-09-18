import { parseGoogleDocsCommentNotification } from './google-docs-notification'

const notification = {
  from: 'Google Docs <comments-noreply@docs.google.com>',
  subject: 'New comment in "Projekt Houston"',
  body: [
    'Test User',
    '@current.user@example.test je tohle správné vysvětlení obrázku?',
    'https://docs.google.com/document/d/document-123/edit?disco=comment-1',
  ].join('\n'),
  snippet: '',
}

describe('parseGoogleDocsCommentNotification', () => {
  it('matches mentions against the dynamically connected Gmail account', () => {
    const currentUser = parseGoogleDocsCommentNotification(
      notification,
      'Current.User@Example.Test',
    )
    const otherUser = parseGoogleDocsCommentNotification(
      notification,
      'other.user@example.test',
    )

    expect(currentUser).toEqual(expect.objectContaining({
      documentId: 'document-123',
      documentUrl: 'https://docs.google.com/document/d/document-123',
      documentTitle: 'Projekt Houston',
      mentionsCurrentUser: true,
      mentionsOtherUsers: false,
    }))
    expect(otherUser).toEqual(expect.objectContaining({
      mentionsCurrentUser: false,
      mentionsOtherUsers: true,
    }))
  })

  it('keeps mention ownership unknown when connector identity is unavailable', () => {
    expect(parseGoogleDocsCommentNotification(notification)).toEqual(expect.objectContaining({
      mentionsCurrentUser: null,
      mentionsOtherUsers: true,
    }))
  })

  it('detects replies to the current user comment independently of mentions', () => {
    const result = parseGoogleDocsCommentNotification({
      ...notification,
      body: 'Test User replied to your comment\nhttps://docs.google.com/document/d/document-123/edit',
    }, 'user@example.com')

    expect(result).toEqual(expect.objectContaining({
      mentionedEmails: [],
      mentionsCurrentUser: false,
      repliesToCurrentUser: true,
    }))
  })

  it('detects another common reply-to-own-comment wording', () => {
    const result = parseGoogleDocsCommentNotification({
      ...notification,
      body: 'Test User replied to a comment you left\nhttps://docs.google.com/document/d/document-123/edit',
    }, 'user@example.com')

    expect(result?.repliesToCurrentUser).toBe(true)
  })

  it('detects a reply from the notification subject without a direct mention', () => {
    const result = parseGoogleDocsCommentNotification({
      ...notification,
      subject: 'Test User replied to a comment in "Projekt Houston"',
      body: 'Je to takto v pořádku?\nhttps://notifications.google.com/g/p/tracking-token',
    }, 'current.user@example.test')

    expect(result).toEqual(expect.objectContaining({
      repliesToCurrentUser: true,
      mentionsCurrentUser: false,
    }))
  })

  it('uses the document title when Google provides only a tracking link', () => {
    const result = parseGoogleDocsCommentNotification({
      ...notification,
      body: '@current.user@example.test prosím zkontroluj komentář.\nhttps://notifications.google.com/g/p/tracking-token',
    }, 'current.user@example.test')

    expect(result).toEqual(expect.objectContaining({
      documentId: 'title-projekt-houston',
      documentUrl: undefined,
      mentionsCurrentUser: true,
    }))
  })

  it('rejects a spoofed document URL and non-Google senders', () => {
    expect(parseGoogleDocsCommentNotification({
      ...notification,
      body: 'https://docs.google.com.evil.example/document/d/document-123/edit',
    }, 'user@example.com')).toBeUndefined()
    expect(parseGoogleDocsCommentNotification({
      ...notification,
      from: 'attacker@example.com',
    }, 'user@example.com')).toBeUndefined()
  })
})