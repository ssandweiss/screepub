# Emailing scripts to your Kindle

Amazon lets you email documents to your Kindle and they show up wirelessly.
This is the *better* way to read a Screepub book: Amazon re-typesets what you
send, so scene breaks and page breaks land where they should. A plugged-in USB
transfer uses an older rendering path that ignores those rules.

It's also the only route for newer Kindles, which speak MTP instead of
appearing as a drive, so nothing shows up in Finder to copy onto.

The setup happens once on Amazon's side, and it is genuinely confusing the
first time. **Both steps are required.** Most people do the first, skip the
second, and then their scripts silently never arrive.

Everything below is at Amazon → **Manage Your Content and Devices** →
**Preferences** → **Personal Document Settings**
([direct link](https://www.amazon.com/hz/mycd/digital-console/alldevices)).

## 1. Find your Kindle's own email address

Under *Send-to-Kindle E-Mail Settings*, each device has an address like
`yourname_a1b2c3@kindle.com`. That's where you send scripts. You can edit the
part before the `@` to something memorable. Paste it into Screepub's Settings
(⌘,) and the app will offer to copy it for you on every conversion.

## 2. Approve the address you send *from*

**This is the step everyone misses.**

Under *Approved Personal Document E-Mail List*, click **Add a new approved
e-mail address** and add your own everyday email, the one you'll be sending
from.

Amazon **silently discards** documents from any address not on this list. No
bounce, no error, no message. If your scripts never turn up, this is almost
always why.

## Then just send it

Attach the EPUB to a normal email addressed to your `@kindle.com` address and
hit send. Subject and body don't matter. It lands on every Kindle on the
account, usually within a minute or two.

> Send the **EPUB**, not the MOBI or AZW3. Amazon stopped accepting those for
> email delivery in 2022. Screepub's **Save a Copy…** defaults to EPUB and
> labels each format by what it's for, so you don't have to keep track.

## What Amazon receives

You are handing your script to a third party. Amazon receives the file and
their terms apply to it, not ours. That is your call to make, and Screepub
never makes it for you: see
[Your script stays on your machine](../README.md#your-script-stays-on-your-machine).
If the material is confidential, USB is the route that never touches a
network.
