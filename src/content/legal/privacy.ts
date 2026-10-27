/**
 * The privacy notice, in the small Markdown subset LegalDoc renders.
 * {{placeholders}} are filled from src/lib/legal.ts. "[REVIEW: ...]" notes
 * mark clauses for a professional check: they are kept here and in the
 * reviewable copy, and stripped from the page.
 */
export const PRIVACY_UPDATED = "27 October 2026";

export const PRIVACY = `
## Who we are

More is a family planning app run by {{controller}}, a sole trader in the UK. {{controller}} is the "controller" of your personal data under UK data protection law: the person who decides how it is used and is responsible for it. [REVIEW: confirm the controller is the individual sole trader, not a company, at the time of publishing]

Contact: {{contact}}. Postal address: {{address}}. ICO registration number: {{ico}}.

More is in an early test (a "beta"). It is free, and it is used by a small number of households who have been invited.

## The short version

- We hold what you put into More so that it can plan your household's week. We do not sell it, share it for advertising, or show adverts.
- Your partner sees the household's shared plans. Things marked as yours alone (your journal, check-ins, private details of your own time, what would help you) are never shown to them.
- If you use the Household Desk's letter reader, the letter is sent to Anthropic, an AI company, to be read once. More does not keep the letter.
- You can download your data and close your account yourself, in Settings.

## What we hold, and why

**Your account.** Your email address (from signing in), the name you go by, your time zone and your settings, such as quiet hours. We need these to let you sign in and run More for you. Lawful basis: performing our contract with you (UK GDPR Article 6(1)(b)).

**Your household.** The household's name, its adults, invitations you send, the household's town if you add one (as a place name and a map position), your evening times and spending guide, plans, diary entries, calendars you import, jobs, meals, shopping lists and money you record. Lawful basis: performing our contract with you.

**Your partner and other adults.** When you invite another adult, we hold what you and they enter. Each adult has their own account and their own private space. Lawful basis: performing our contract with each adult.

**Children.** For each child: the name they go by, an age band (never a date of birth), and, only if you add it, a short note that helps planning, which both adults can see. If you set up a child's view on a household screen, we keep the picks a child makes there. Children do not have accounts. We hold this to plan around your children, which is the purpose of More. Lawful basis: our legitimate interest, and yours, in organising your family's care (Article 6(1)(f)). [REVIEW: legitimate interests assessment for children's data; confirm whether the parent's contract basis is preferable]

**Health or additional needs.** The optional note about a child can hold information about health or additional needs (for example "finds loud places hard"). This is special category data. Only add it if it helps you plan, and keep it short. We use it only to show it to the adults in your household. [REVIEW: Article 9 condition. Options: the parent's explicit consent recorded in the app, or advising adults not to enter health information. The app does not yet record explicit consent]

**Helpers.** If you add a helper, such as a grandparent, we hold their name, how they are related and, if you add it, their phone number. When you ask them to help, they get a link showing the time, the children's first names and a way to reply. Lawful basis: our legitimate interest in letting you arrange care (Article 6(1)(f)). Please tell helpers you have added them. [REVIEW: transparency to helpers, who never see this notice unless told]

**Things private to you.** Your journal, check-ins, reflections, the private details of your own time (title, notes, place, activity, preparation, highlights, planned spending limit) and what would help you. Your partner sees only that you are busy at that time, who is involved, any childcare needed and money recorded. What would help you shapes small suggestions on your partner's screen; they never see what you wrote. Lawful basis: performing our contract with you.

**Letters you give the Household Desk.** You can paste a school or club letter, or add a photo or PDF of one. More reads it into suggested diary entries, and nothing goes into your diary until you tick it. When the AI reader is on, the letter is sent to Anthropic to be read once; otherwise it is read on your phone. More does not keep the letter, only the entries you tick. More never adds your children's names to what it sends, but a letter may already contain names, and those are sent as they appear in the letter. Lawful basis: performing our contract with you. See "AI" below.

**Trial questions.** If you answer the weekly trial questions, we keep your answers to learn whether More helps. Answering is optional. Lawful basis: your consent (Article 6(1)(a)); you can stop at any time and ask us to delete your answers.

**Product events.** We record that things happened (for example "a plan was agreed"), with a short code and pseudonymous ids. We never record the content of your plans, titles, places or children's names in these events. We use them to see whether More works and to fix problems. You can switch them off in Settings. Lawful basis: our legitimate interest in improving More (Article 6(1)(f)).

**Security and support.** We keep a record of important actions (for example "account closed") without their content, to keep accounts secure and to put things right. If you write to us, we keep your message and the contact you give. Lawful basis: our legitimate interests in security and in answering you.

**Reminders.** If you switch them on, we send notifications to your devices and a Sunday email. These are about your household's plans, not marketing. We do not send marketing.

## AI

The Household Desk can use an AI model from Anthropic to read a letter you give it. Anthropic acts for us as a processor. Under its commercial terms, Anthropic does not use what we send to train its models, and for the model More uses it does not keep the letter after replying, except that content flagged by its safety systems may be kept for up to two years. [REVIEW: confirm Anthropic's data processing addendum covers us, the model in use is not one it retains by default, and the transfer mechanism to the US]

The AI suggests; it does not decide. Nothing is added to your diary until you tick it, and the reader can be wrong, so check dates against the letter. More makes no decisions about you that have legal or similarly significant effects. Its other suggestions (for example dinner ideas or a small kindness) come from simple rules, not AI.

## Who else handles your data

We use these service providers. Each works for us under a contract and may use the data only to provide their service.

- **Vercel** (USA): hosts the app. Our servers run in London.
- **Supabase** (USA): our database and sign-in emails. The database is in London.
- **Anthropic** (USA): reads Household Desk letters when the AI reader is on. {{controller}} also uses Anthropic's AI assistant to help build and run More, and it may see data when fixing a problem or producing summary figures for the trial. [REVIEW: confirm this use is covered by Anthropic's commercial terms and processing addendum]
- **GitHub** (USA): stores our nightly backups, encrypted before they leave our database.
- **Resend** (USA): sends emails from More when email is switched on.
- **Open-Meteo** (Germany): weather forecasts. When you search for your town, your browser sends what you typed to Open-Meteo; our server sends only your town's map position to fetch forecasts.
- **Apple, Google and Mozilla**: deliver notifications to your device if you allow them. The content is encrypted on the way.
- **Google or Microsoft**: only if you connect a calendar from them.

Some of these providers are based in, or may access data from, the USA. Where data leaves the UK, it is protected by UK adequacy regulations (including the UK Extension to the EU-US Data Privacy Framework, where the provider is certified) or by the UK's International Data Transfer Addendum. [REVIEW: confirm the mechanism for each provider and sign each provider's data processing agreement]

We may share data if the law requires it, or to protect someone from serious harm.

## How long we keep it

- **While your account is open**, we keep your data so More can work.
- **When you close your account**, everything that was only yours is erased straight away: your journal, check-ins, private records, what would help you, trial answers, notifications and devices. Your name becomes "Former member" on history you shared with your household.
- **When a household is deleted**, it is hidden from everyone straight away. Its records are then erased by us within 30 days. [REVIEW: this erasure is currently done by hand; an automatic purge should exist before households outside the founder's own join]
- **Backups** are encrypted and kept for 14 days, then deleted automatically. Erased data can survive in a backup until that backup expires.
- **Letters** given to the Household Desk are not kept by More.
- **Support messages** are kept until we have dealt with them and for up to 12 months afterwards. **Product events and security records** are kept for up to 24 months. [REVIEW: these limits are policy; deletion is not yet automatic]

## Your rights

You have the right to:

- get a copy of your data (Settings has "Download my private data" and "Download household data"),
- have wrong data corrected (most of it you can edit yourself),
- have your data erased (Settings lets you leave a household and close your account),
- object to, or ask us to limit, how we use your data,
- withdraw consent where we rely on it, such as trial answers,
- move your data to another service.

To use any of these rights, contact us at {{contact}}. We will reply within one month. You do not have to pay.

If you are unhappy with how we use your data, please tell us first. You can also complain to the Information Commissioner's Office (ICO): [ico.org.uk/make-a-complaint](https://ico.org.uk/make-a-complaint), or 0303 123 1113.

## Children

More is for adults aged 18 or over. Children do not sign up. A child's view, if you set one up, shows that child their own week and lets them pick from a short list when it is their turn; it shows no adverts, makes no suggestions to buy anything and sends nothing outside the household. [REVIEW: Age Appropriate Design Code assessment for the child's view and kitchen display]

## Cookies and storage on your device

More uses only what it needs to work: a sign-in cookie that keeps you signed in, and small notes in your browser that remember things such as a card you dismissed. We use no advertising or tracking cookies, so we do not ask for cookie consent. [REVIEW: confirm all storage is strictly necessary under PECR]

## Keeping data safe

Data is encrypted in transit and at rest with our providers. Each household's data is kept apart from every other household's by the database itself. Calendar tokens and backups are encrypted. Only {{controller}}, and the tools they use to run More, can reach the live database.

## Changes

If we change this notice in a way that matters, we will tell you in the app before the change applies. The date at the top shows when it last changed.
`;
