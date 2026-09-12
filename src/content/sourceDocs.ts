import type { SourceDoc } from '@/types'

/**
 * The "boring material" a company would actually hand over. The authoring
 * screen runs the Knowledge Agent over these to show CONTENT -> KNOWLEDGE ->
 * SCENARIO -> EPISODE. Excerpts are written in real policy-document voice
 * precisely because that is what nobody reads.
 */
export const sourceDocs: SourceDoc[] = [
  {
    id: 'doc1',
    name: 'Helix Security Handbook v4.2.pdf',
    type: 'pdf',
    pages: 48,
    excerpt:
      '3.1 Email Threats. Employees shall report any electronic message exhibiting indicators of compromise via the Report Phish control present in Helix Mail or, where unavailable, via the Security Portal. Onward transmission of suspected malicious messages to colleagues is prohibited. 3.2 Pressure Tactics. Indicators include, but are not limited to, assertions of urgency, threatened suspension of services, and instructions to complete an action within a defined interval...',
    yields: ['K-PHI-01', 'K-PHI-02', 'K-PHI-03', 'K-SOC-01', 'K-PHY-01'],
  },
  {
    id: 'doc2',
    name: 'Access Control Policy (rev 11).pdf',
    type: 'policy',
    pages: 16,
    excerpt:
      '2.4 Account Ownership. Authentication credentials are issued to a single named individual and are non-transferable. Disclosure of credentials or second-factor material to any party, including personnel of the IT function, constitutes a policy violation irrespective of intent. 2.6 Multi-Factor. Helix personnel shall not solicit one-time passcodes under any circumstances...',
    yields: ['K-PWD-01', 'K-PWD-02', 'K-PWD-03'],
  },
  {
    id: 'doc3',
    name: 'Data Protection Standard.docx',
    type: 'handbook',
    pages: 23,
    excerpt:
      '4.2 Permitted Processing. Personal data relating to customers may be processed solely within systems enumerated in Appendix B. Transfer to, or processing within, any system not so enumerated — including but not limited to third-party generative AI services, personal cloud storage and unmanaged endpoints — is prohibited and shall be treated as a reportable event under clause 9...',
    yields: ['K-DAT-01', 'K-DAT-02'],
  },
  {
    id: 'doc4',
    name: 'Acceptable Use + AI Tools (all-hands deck).pptx',
    type: 'slides',
    pages: 31,
    excerpt:
      'Slide 12: "APPROVED TOOLS ONLY" — check the catalogue before you sign up for anything. Slide 14: "Helix Assist is our AI. No training on your data. 30-day retention. Use it." Slide 15: bullet list of last quarter\'s shadow-IT findings (14 unreviewed SaaS accounts created with @helix addresses)...',
    yields: ['K-TOL-01', 'K-TOL-02'],
  },
  {
    id: 'doc5',
    name: 'Onboarding Day 1 — Security Briefing.mp4',
    type: 'video',
    pages: 0,
    excerpt:
      '[00:00–31:40 transcript] "...so, again, the one-hour reporting window. I know it sounds aggressive. The reason we say one hour and not one day is that session tokens survive a password change, so until you tell us, we cannot revoke anything. There is no blame attached to a report. I want to be really clear about that, because the thing that costs us money is not the click. It is the four days of silence afterwards..."',
    yields: ['K-INC-01', 'K-INC-02'],
  },
]
