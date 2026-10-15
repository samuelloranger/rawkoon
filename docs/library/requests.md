# Requests

Only administrators add titles to the library. Everyone else asks for them: a
request puts a movie, show, or book in front of the administrators, who approve
or deny it. Requests work the same way on the web and in the iPhone app.

## Ask for a title

Open a movie or show from **Explore**, or a book from the books search, and
choose **Request**. The title shows its request state from then on, and
**Requests** lists everything you have asked for.

A title can only be requested once. If someone has already asked for it and the
request is pending or approved, asking again is refused, and the title shows
that it is already requested. A title already in the library cannot be
requested.

Members see only their own requests. Administrators see every request on the
instance, with who asked for it.

## What each state means

| State | Meaning |
| --- | --- |
| Pending | Waiting for an administrator. Every administrator is notified when a request arrives. |
| Approved | An administrator accepted it and the title is in the library. Rawkoon is searching for it, or it is still downloading. |
| Denied | An administrator declined it, optionally with a reason that the requester can read. |
| Available | The title finished downloading. The requester is notified. |

The person who asked is notified when their request is approved, denied, and
again when it becomes available. Each of these notifications can be turned off
in the notification settings.

## Approving a request

An administrator approves a request by choosing a quality profile for it. For a
movie or show, that is a media quality profile; for a book, a book quality
profile, applied to both its ebook and audiobook editions. Approval adds the
title to the library exactly as adding it directly would, and the regular
automatic searches take it from there. See
[Downloads and files](/library/downloads-and-files#automatic-searches) for when
those run.

Approval does not start a search immediately. A movie that has not had its
digital release yet stays wanted, and its request stays **Approved**, until it
is released and found.

## When a request becomes available

- **Movie:** when its download completes and is imported.
- **Show:** only when the whole show is complete. A show that is still airing,
  in production, or planned keeps its request **Approved** even when every
  episode released so far is downloaded, because more episodes are coming. A
  single finished episode never completes a show's request.
- **Book:** when the first edition of the book, ebook or audiobook, finishes
  importing. A request does not choose a format, so either one satisfies it.

## Asking again after a denial

A denied request is not final. If anyone asks for the same title again, the
request goes back to **Pending** under the new requester, its previous deny
reason is cleared, and the administrators are notified again.
