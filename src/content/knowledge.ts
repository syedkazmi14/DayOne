import type { ConceptId, ConceptMeta, KnowledgeItem } from '@/types'

/* ============================================================================
 * KNOWLEDGE BASE — Helix Dynamics, Security & Data Handling
 *
 * This file is the OUTPUT SHAPE of the Knowledge Agent, not hand-authored
 * dialogue. In production `knowledgeBase` is populated by running
 * `runKnowledgeAgent()` (src/ai/knowledgeAgent.ts) over uploaded company
 * material. Here it is pre-extracted mock knowledge so the demo runs offline.
 *
 * Every character answer at runtime is retrieved from this array and cited by
 * id. If retrieval finds nothing, the character says it doesn't know.
 * ========================================================================== */

export const concepts: ConceptMeta[] = [
  { id: 'phishing', label: 'Phishing', blurb: 'Spotting and reporting deceptive messages.' },
  { id: 'password_security', label: 'Credentials', blurb: 'Passwords, MFA, and never sharing access.' },
  { id: 'data_handling', label: 'Data Handling', blurb: 'Where customer data may and may not go.' },
  { id: 'approved_tools', label: 'Approved Tools', blurb: 'Using vetted software for company work.' },
  { id: 'incident_reporting', label: 'Incident Reporting', blurb: 'Raising problems fast and without blame.' },
  { id: 'social_engineering', label: 'Social Engineering', blurb: 'Pressure, urgency and impersonation.' },
  { id: 'physical_security', label: 'Physical Security', blurb: 'Badges, screens, and unattended devices.' },
]

export const conceptLabel = (id: ConceptId) =>
  concepts.find((c) => c.id === id)?.label ?? id

export const knowledgeBase: KnowledgeItem[] = [
  {
    id: 'K-PHI-01',
    topic: 'Reporting suspicious email',
    rule: 'Report any suspicious or unexpected email using the Report Phish button in Helix Mail, or through the Security Portal. Do not forward it to colleagues.',
    severity: 'high',
    commonMistake: 'Clicking the link "just to see" whether the page looks real.',
    consequence:
      'A credential-harvesting page can capture your password and MFA code in real time, giving an attacker an authenticated session inside Helix.',
    edgeCases: [
      'The sender address looks internal — display names and domains can be spoofed, and real accounts do get compromised.',
      'The email is a reply inside an existing thread — attackers hijack threads after compromising one mailbox.',
    ],
    recommended: ['Use Report Phish', 'Verify through a known channel', 'Leave the message unopened in place'],
    prohibited: ['Clicking links in unexpected mail', 'Forwarding suspected phish to teammates', 'Replying to ask if it is real'],
    concepts: ['phishing', 'incident_reporting'],
    source: { doc: 'Helix Security Handbook v4.2', section: '3.1 Email Threats', page: 12 },
  },
  {
    id: 'K-PHI-02',
    topic: 'Urgency as an attack signal',
    rule: 'Treat urgency, threats of account suspension, and requests to act "immediately" as warning signs, regardless of who appears to be asking.',
    severity: 'high',
    commonMistake: 'Complying quickly because the message appears to come from a manager or from IT.',
    consequence: 'Urgency is used to suppress verification. Most successful Helix-targeted attacks in the last year used a deadline.',
    edgeCases: [
      'Genuine incidents do exist, but Helix IT will never ask you to verify a password via an emailed link.',
      'A real manager under time pressure will accept a 60-second verification call.',
    ],
    recommended: ['Slow down', 'Verify out of band', 'Call the person on a known number'],
    prohibited: ['Acting on emailed deadlines without verification'],
    concepts: ['phishing', 'social_engineering'],
    source: { doc: 'Helix Security Handbook v4.2', section: '3.2 Pressure Tactics', page: 13 },
  },
  {
    id: 'K-PHI-03',
    topic: 'IT never asks for verification by link',
    rule: 'Helix IT never asks you to confirm, verify, or re-enter your account credentials through a link in an email or chat message.',
    severity: 'critical',
    commonMistake: 'Assuming a well-designed login page that looks like the Helix SSO page is genuine.',
    consequence: 'Entering credentials on a lookalike page is the single most common route to account takeover.',
    edgeCases: ['Password expiry reminders are real, but you change the password by navigating to helix.internal yourself.'],
    recommended: ['Type the known URL yourself', 'Use the IT Service Desk number on your badge'],
    prohibited: ['Entering your password on a page you reached from an email'],
    concepts: ['phishing', 'password_security'],
    source: { doc: 'Helix Security Handbook v4.2', section: '3.3 Credential Harvesting', page: 14 },
  },
  {
    id: 'K-PWD-01',
    topic: 'Never share credentials',
    rule: 'Never share your password, MFA code, or session with anyone — including colleagues, managers, and IT staff. Accounts are personal and non-transferable.',
    severity: 'critical',
    commonMistake: 'Lending a login to a teammate who is "blocked" and needs access urgently.',
    consequence:
      'Shared credentials destroy attribution. If something breaks, the audit log points at you, and Helix cannot prove who acted.',
    edgeCases: [
      'A colleague whose access was revoked has had it revoked deliberately — that is the control working, not a bug.',
      'Genuine emergency access is granted through the break-glass process, not by borrowing an account.',
    ],
    recommended: ['Request access via the Access Portal', 'Use break-glass for genuine emergencies', 'Escalate to the on-call manager'],
    prohibited: ['Sharing passwords', 'Reading out MFA codes', 'Leaving a session open for someone else'],
    concepts: ['password_security', 'social_engineering'],
    source: { doc: 'Helix Access Control Policy', section: '2.4 Account Ownership', page: 5 },
  },
  {
    id: 'K-PWD-02',
    topic: 'MFA codes are never requested',
    rule: 'No Helix system, employee, or support agent will ever ask you to read out a multi-factor authentication code. Anyone who does is attacking you.',
    severity: 'critical',
    commonMistake: 'Reading a code aloud during a convincing phone call from "IT support".',
    consequence: 'The caller is mid-login on your account; the code completes their sign-in within seconds.',
    edgeCases: ['MFA fatigue: repeated push prompts you did not trigger mean an attacker already has your password — deny and report.'],
    recommended: ['Hang up and call the Service Desk on the badge number', 'Report the call through the Security Portal'],
    prohibited: ['Reading MFA codes to anyone', 'Approving push prompts you did not initiate'],
    concepts: ['password_security', 'social_engineering', 'incident_reporting'],
    source: { doc: 'Helix Access Control Policy', section: '2.6 Multi-Factor', page: 7 },
  },
  {
    id: 'K-PWD-03',
    topic: 'Password manager is mandatory',
    rule: 'All Helix credentials must be generated and stored in the company password manager. Reuse of a Helix password on any external site is prohibited.',
    severity: 'high',
    commonMistake: 'Reusing a memorable password across the tools you use every day.',
    consequence: 'One breached external site turns into a working Helix login through credential stuffing.',
    edgeCases: ['Personal accounts used for work, such as a signup for a vendor trial, still count as work credentials.'],
    recommended: ['Generate unique passwords in the vault', 'Enable MFA everywhere it is offered'],
    prohibited: ['Reusing passwords', 'Storing passwords in notes, spreadsheets or browser autofill outside the vault'],
    concepts: ['password_security'],
    source: { doc: 'Helix Access Control Policy', section: '2.1 Password Standards', page: 3 },
  },
  {
    id: 'K-DAT-01',
    topic: 'Customer data may not leave approved systems',
    rule: 'Customer personal data may only be processed inside approved Helix systems. It must never be pasted into external websites, chat tools, or AI services.',
    severity: 'critical',
    commonMistake: 'Pasting a customer export into a public AI assistant to summarise or clean it up faster.',
    consequence:
      'Once data leaves an approved system Helix loses control of retention, deletion and jurisdiction. It is a reportable data breach under our DPA commitments.',
    edgeCases: [
      'Anonymised-looking data is often still personal data — names removed but account ids, emails or free text remain.',
      'A tool being popular, or already used by another team, is not the same as being approved.',
    ],
    recommended: ['Use Helix Assist, the approved internal AI tool', 'Work on data inside the approved warehouse'],
    prohibited: ['Pasting customer records into external AI tools', 'Emailing exports to personal addresses', 'Uploading exports to personal cloud drives'],
    concepts: ['data_handling', 'approved_tools'],
    source: { doc: 'Data Protection Standard', section: '4.2 Permitted Processing', page: 9 },
  },
  {
    id: 'K-DAT-02',
    topic: 'Minimum necessary access',
    rule: 'Only access and export the minimum customer data needed for the task in front of you, and delete working copies when the task is done.',
    severity: 'high',
    commonMistake: 'Exporting the full table because filtering it would take longer.',
    consequence: 'Oversized exports are the reason small mistakes become large breaches.',
    edgeCases: ['Debugging a single customer issue does not justify a full-table export.'],
    recommended: ['Filter before exporting', 'Delete working copies', 'Prefer in-place queries'],
    prohibited: ['Bulk exports without an approved business reason'],
    concepts: ['data_handling'],
    source: { doc: 'Data Protection Standard', section: '4.5 Data Minimisation', page: 11 },
  },
  {
    id: 'K-TOL-01',
    topic: 'Approved software only',
    rule: 'Only software listed in the Helix Approved Tools Catalogue may be used for company work. New tools go through a security and privacy review before use.',
    severity: 'high',
    commonMistake: 'Installing a free browser extension or signing up for a SaaS trial to finish a task faster.',
    consequence: 'Unreviewed tools may exfiltrate data, train on it, or retain it in jurisdictions Helix has not contracted for.',
    edgeCases: [
      'A tool with a free tier still processes company data — free does not mean approved.',
      'A colleague already using a tool does not mean it has passed review; it may mean nobody has noticed yet.',
    ],
    recommended: ['Check the Approved Tools Catalogue', 'Request review — the fast track takes two working days'],
    prohibited: ['Signing up for unreviewed SaaS with a Helix address', 'Installing unvetted browser extensions'],
    concepts: ['approved_tools', 'data_handling'],
    source: { doc: 'Acceptable Use Policy', section: '5.1 Software', page: 4 },
  },
  {
    id: 'K-TOL-02',
    topic: 'Helix Assist is the approved AI tool',
    rule: 'Helix Assist is the only AI assistant approved for company data. It runs under a no-training agreement with a 30-day retention limit.',
    severity: 'medium',
    commonMistake: 'Using a personal AI account because it is the one you already know.',
    consequence: 'Consumer AI accounts may retain and train on submitted content, which breaks our customer commitments.',
    edgeCases: ['Public, non-customer information such as open documentation may be used with external tools.'],
    recommended: ['Use Helix Assist for anything touching customer or internal data'],
    prohibited: ['Pasting internal or customer content into consumer AI accounts'],
    concepts: ['approved_tools', 'data_handling'],
    source: { doc: 'Acceptable Use Policy', section: '5.4 AI Tools', page: 6 },
  },
  {
    id: 'K-INC-01',
    topic: 'Report fast, blame never',
    rule: 'Report suspected security incidents within one hour through the Security Portal or the #sec-incident channel. Helix operates a no-blame reporting policy.',
    severity: 'critical',
    commonMistake: 'Waiting to see whether anything bad actually happens, or trying to fix it quietly first.',
    consequence: 'Containment in the first hour usually prevents damage. After a day it is usually an incident response exercise.',
    edgeCases: [
      'If you clicked a link and did nothing else, it is still reportable — the visit alone can be enough.',
      'Uncertainty is not a reason to delay; over-reporting is explicitly encouraged.',
    ],
    recommended: ['Report within the hour', 'Disconnect the device if asked', 'Keep the evidence in place'],
    prohibited: ['Delaying reports', 'Deleting the suspicious message', 'Handling it quietly yourself'],
    concepts: ['incident_reporting'],
    source: { doc: 'Incident Response Plan', section: '1.2 Duty to Report', page: 2 },
  },
  {
    id: 'K-INC-02',
    topic: 'What to do after clicking',
    rule: 'If you clicked a suspicious link or entered credentials, disconnect from the network, report immediately, and change your password from a different trusted device.',
    severity: 'critical',
    commonMistake: 'Changing the password on the possibly-compromised machine and assuming that closes it.',
    consequence: 'An attacker with an active session or local malware can capture the new password too.',
    edgeCases: ['Session tokens survive a password change — IT must revoke them, which is why reporting matters.'],
    recommended: ['Disconnect', 'Report', 'Rotate credentials from a clean device'],
    prohibited: ['Carrying on as normal', 'Assuming a password change is sufficient'],
    concepts: ['incident_reporting', 'phishing', 'password_security'],
    source: { doc: 'Incident Response Plan', section: '2.1 First Response', page: 4 },
  },
  {
    id: 'K-SOC-01',
    topic: 'Verify through a trusted channel',
    rule: 'Verify unexpected requests through a channel you already trust — a known phone number, a direct message in Helix Chat, or in person. Never verify using contact details supplied in the request itself.',
    severity: 'high',
    commonMistake: 'Calling the number printed in the suspicious email to check whether the email is genuine.',
    consequence: 'The attacker controls the verification channel and cheerfully confirms their own request.',
    edgeCases: ['Voice and video can be convincingly cloned; treat a familiar voice as a claim, not as proof.'],
    recommended: ['Use the directory, not the message', 'Confirm in person where possible'],
    prohibited: ['Verifying via details contained in the suspicious request'],
    concepts: ['social_engineering', 'phishing'],
    source: { doc: 'Helix Security Handbook v4.2', section: '6.1 Verification', page: 22 },
  },
  {
    id: 'K-PHY-01',
    topic: 'Lock your screen, guard your badge',
    rule: 'Lock your screen whenever you step away, never hold doors open for people without a visible badge, and do not display customer data in public spaces.',
    severity: 'medium',
    commonMistake: 'Holding the door for someone carrying coffee and boxes.',
    consequence: 'Tailgating gives physical access to desks, screens and unattended unlocked devices.',
    edgeCases: ['Politeness is not a security control — direct people to reception without embarrassment.'],
    recommended: ['Lock with the keyboard shortcut', 'Direct unbadged visitors to reception'],
    prohibited: ['Leaving devices unlocked', 'Tailgating or letting others tailgate'],
    concepts: ['physical_security'],
    source: { doc: 'Helix Security Handbook v4.2', section: '7.2 On Site', page: 26 },
  },
]

export const knowledgeById = (id: string) => knowledgeBase.find((k) => k.id === id)
