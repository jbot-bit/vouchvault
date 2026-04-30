---
source: https://telegram.org/tos/bot-developers
captured: 2026-04-29
status: verbatim — refresh by re-fetching wholesale, do not selectively edit
note: WebFetch markdown conversion. Page is a structured ToS with numbered sections (1–14) and subsections; captured in full.
---

# Telegram Bot Platform Developer Terms of Service

## Overview

The Telegram Bot Platform Developer Terms of Service governs how developers create and operate Bots and Mini Apps (collectively "Third Party Apps" or "TPA") that integrate with Telegram. These terms establish a legally binding agreement between developers and Telegram Messenger Inc.

## Key Sections

### 1. Acceptance of Terms

By connecting services to Telegram via Bot Platform, developers agree to be bound by these terms, the Telegram Terms of Service, and the Telegram Privacy Policy. Continued operation of any TPA constitutes acceptance of all terms and any future updates.

### 2. Scope and Independent Participation

TPAs are third-party services hosted on developers' own servers. Developers function as independent entities, and these terms create no agency, partnership, employment, or joint venture relationship with Telegram. Verified status for bots is assigned at Telegram's discretion and does not constitute endorsement.

### 3. Availability

Bot Platform availability may vary by user, client, region, and other factors. Telegram makes no obligation to provide advance notice, compensation, or explanations for changes to availability.

### 4. Privacy Requirements

#### 4.1 Data Sharing

TPAs receive specific data detailed in Telegram's Privacy Policy section "6.3. What Data Bots Receive." Developers may request additional data with user consent but cannot deceive users to circumvent Telegram's data access limitations.

#### 4.2 Data Storage and Retention

Developers must:
- Delete user data upon request
- Delete data when retention becomes unnecessary
- Delete all user data upon TPA cessation (unless users explicitly agree otherwise)
- Comply with lawful deletion requests from authorized entities

#### 4.3 Data Scraping

"You agree not to use your TPA to collect, store, aggregate or process data beyond what is essential for the operation of your services." Data collection for machine learning, AI products, or scraping public content is prohibited. Users must provide explicit, individual, active, and revocable consent for data use.

#### 4.4 Security Practices

Minimum requirements include:
- Encrypting user data at rest with separate encryption keys
- Alerting users of data breaches per applicable law
- Operating TPAs in secure environments with proper vetting
- Immediately remediating security breaches
- Employing required security checks for applicable features
- Protecting TPAs from malicious clients

#### 4.5 Credentials

API credentials, tokens, and other confidential credentials provided by Telegram are strictly confidential. Public disclosure is explicitly prohibited. Actions taken using developer credentials are attributed to the developer regardless of how others obtained them.

### 5. Code of Conduct

#### 5.1 Content Compliance

TPA content must comply with Telegram Terms of Service. Developers are responsible for user-generated content moderation, though Telegram may also intervene without obligation.

#### 5.2 Operational Requirements

TPAs must:
- Comply with Telegram Terms of Service in all communications and functions
- Not harass or spam users with unsolicited messages
- Not impersonate Telegram or unauthorized entities
- Accurately represent services and functions provided

Explicitly forbidden practices include:
- MLM or Ponzi schemes
- Social growth manipulation
- Phishing and deceptive data collection
- Requesting Telegram passwords or OTPs
- Misrepresenting illegal products as legal

Additional prohibitions:
- Cannot circumvent Telegram rate limits or moderation
- Cannot distribute malware or harmful software
- Cannot distribute illegal, pirated, or regulated goods
- Cannot promote violence, hate speech, harassment, or non-consensual personal information

#### 5.3 Interface Requirements

TPA interfaces must be complementary to Telegram apps. All interface elements must remain functional and not obstruct user actions within Telegram. Developers cannot alter interface elements to falsely appear as notifications from Telegram, the operating system, or unauthorized third parties.

#### 5.4 Telegram Business

For TPAs designated as Chatbots under Telegram Business, developers must:
- Truthfully represent services provided
- Clearly state what private user data will be retained and for how long
- Use message contents and files solely for providing chatbot services
- Never disclose data to third parties without user authorization
- Not conceal TPA activity from the business account owner
- Promptly notify users of significant operational changes

Violations may result in immediate permanent ban and legal action.

### 6. Payments

#### 6.1 Physical Goods and Services

Telegram does not process payments for physical goods and services. Developers must use third-party payment providers of their choice. Telegram stores no credit card details and assumes no financial intermediary role.

Developers are responsible for:
- Understanding and complying with payment provider terms
- Resolving disputes, unclaimed funds, and losses with payment providers
- Managing consequences if Telegram alters Bot Platform affecting payment provider integration

#### 6.2 Digital Goods and Services

All digital goods and services transactions must use Telegram Stars exclusively. Developers must ensure delivery as advertised and respond to `/paysupport` commands.

##### 6.2.1 Payment Disputes

Disputes must be resolved between developer, purchaser, and payment provider—Telegram assumes no mediation role. Developers are responsible for refund amounts deducted from TPA balance. Failure to address legitimate disputes may result in Stars being debited, TPA removal, public "SCAM" labels, or account termination.

##### 6.2.2 TPA Balance

Stars earned are valid for 3 years. Stars are "not your property" but rather "allow you to receive them in exchange for digital goods." Telegram holds no custodian role, and stars have no inherent value beyond Telegram's commitment to advertisement credits and rewards.

##### 6.2.3 Advertising with Stars

Each Star equals 0.02 USD in advertising credit for Telegram Ads. Star value may fluctuate based on promotions and market conditions.

##### 6.2.4 Rewards for Stars

Developers receive 0.013 USD worth of rewards per Star. Telegram determines Star value in its sole discretion independent of historical or anticipated purchase costs. Stars may be withheld or debited for refunds, suspected abuse, or term violations. Stars may take up to 21 days to become available for rewards.

##### 6.2.4.1 Receiving Rewards

Telegram uses Fragment for reward processing. Engagement with Fragment is subject to Fragment's Terms of Service and Privacy Policy. Fragment may be unavailable in certain countries. Telegram assumes no liability if developers cannot access Fragment or receive rewards.

##### 6.2.5 Broadcasting Messages with Stars

Default broadcast limit is 30 messages per second free of charge. Developers with 100,000+ Stars balance and 100,000+ monthly active users may enable increased limits up to 1000 messages per second. Messages exceeding 30 per second cost 0.1 Stars each (non-refundable). Broadcasts must serve legitimate business purposes; spam or harassment is prohibited.

##### 6.2.6 Topics in Private Chats

Enabling topics in private chats incurs a non-refundable 15% fee on all Telegram Stars purchases for that TPA. The fee applies only while the feature remains enabled.

##### 6.2.7 Expiration

Stars expire 3 years after receipt. Unused stars are forfeited and debited from balance.

#### 6.3 Account Management

Developers are responsible for secure storage of credentials and assets. Deletion or loss of the owning Telegram account may result in TPA termination and Star inaccessibility. Telegram makes no guarantee that data stored in connection with TPAs will remain available, uncorrupted, or fit for purpose.

#### 6.4 Taxes

Developers bear sole responsibility for all taxes and fees on income received through Bot Platform. Telegram provides no tax calculation, withholding, or notification services.

### 7. Blockchain Integration

#### 7.1 Asset Issuance

Mini Apps implementing cryptocurrency functionality must exclusively use The Open Network (TON) blockchain for token and asset creation and distribution.

#### 7.2 Wallet Connection

Mini Apps utilizing cryptocurrency wallets must interface exclusively via TON Connect SDK for user authorization, transaction signing, and token receipt/transmission. Other wallet protocols are permitted only for bridging assets from other blockchains.

#### 7.3 Multichain Wallets

Multichain wallet Mini Apps may manage assets on other blockchains provided interactions occur directly within the Mini App interface or via TON Connect for interactions with other apps.

#### 7.4 Promotion

Mini Apps are prohibited from promoting:
- Non-TON cryptocurrency wallets
- Non-TON cryptoassets
- Directing or linking users to external platforms promoting non-TON assets

Exceptions: Developers may direct users to licensed exchanges where their TON-issued tokens are listed, provided both comply with regulations and these terms.

#### 7.5 Grace Period

Compliance with sections 7.1-7.4 required by February 1, 2025. Existing non-TON Mini Apps must transition to TON by February 21, 2025. New blockchain initiatives launched on or after January 21, 2025 must immediately adhere to section 7.1.

### 8. License and Attribution

#### 8.1 Branding

Developers retain ownership of TPA code and services. Telegram retains ownership of its code, functionality, trademarks, servers, architecture, protocols, and APIs. Developers cannot incorporate Telegram intellectual property into TPA branding, names, descriptions, or advertising. Telegram may request branding changes or terminate TPAs it deems potentially affiliated with Telegram.

#### 8.2 Marketing

Developers grant Telegram a "non-exclusive, perpetual, transferable, sub-licensable, royalty-free, and worldwide license" to use TPAs for ecosystem betterment, including marketing, advertising, distribution, hosting, enhancement, and public display.

##### 8.2.1 Featured Mini Apps

Telegram may highlight specific TPAs in app interfaces at its sole discretion based on popularity, functionality, and usefulness. Selection criteria and featured TPAs may change anytime.

#### 8.3 Open Source Licenses

Open source licenses made available by Telegram supersede these terms to the extent necessary for conflict resolution within relevant software scope.

### 9. Compliance with Laws

Developers must ensure TPAs comply with all applicable laws, regulations, and third-party terms (including Apple and Google store guidelines). Developers indemnify Telegram against claims, damages, costs, fees, and legal actions arising from TPA misuse, term violations, or legal non-compliance.

#### 9.1 Data Protection Laws

Developers must comply with all applicable privacy laws including GDPR. Developers determine applicability and responsibility for compliance. Telegram assumes no liability for developer non-compliance.

### 10. Termination

Non-compliance with these terms or Telegram Terms of Service may result in temporary or permanent Bot Platform or Telegram app bans. TPAs become partially or fully inaccessible. Associated Telegram accounts and affiliated channels/communities may also be banned. Developers receive no compensation for termination-related losses.

#### 10.1 Unilateral Termination

Telegram may fully or partially discontinue TPAs or Bot Platform anytime, including in specific regions or for certain users, with no ongoing support guarantee.

#### 10.2 Survivability

Sections 2.1, 4.2, 4.4, 5, 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 7, 7.2, 8, 8.1, 11, and 11.2 survive Bot Platform termination.

### 11. Conflicts of Rules

In conflicts between Bot Developer Terms and other terms governing TPA services, resolutions favor Telegram to the maximum extent permitted by law.

#### 11.1 User Agreements

Developers may require users to accept additional agreements regulating TPA use. Such agreements exist solely between developer and user. They cannot override, alter, or conflict with Bot Developer Terms; these terms prevail in conflicts.

### 12. Liability

Telegram and its subsidiaries, affiliates, officers, agents, contractors, and employees bear no liability for unrealized payments, lost profits, lost funds/assets, lost data, fines, fees, punitive or reputational damages, or other consequences arising from Bot Platform use.

#### 12.1 Misuse of Service

Telegram is not liable for user interactions with TPA services, including user actions, conduct, content, spam, or unintentional use. Developers absolve Telegram from monitoring, controlling, or rectifying user interactions to the maximum extent permitted by law.

#### 12.2 Indemnity

Developers grant Telegram and its subsidiaries, affiliates, officers, agents, contractors, and employees absolute indemnity against claims, actions, proceedings, investigations, demands, suits, expenses, costs, and damages arising from or related to Bot Platform use, conduct, or access.

#### 12.3 Services Provided "As Is"

Bot Platform is provided "as is" and "as available." Telegram disclaims all warranties, express and implied, including merchantability, fitness for purpose, title, and non-infringement. Telegram makes no commitments regarding functionality, profitability, dependability, uptime, precision, quality, appropriateness, legality, efficiency, origin, safety, accessibility, availability, practicality, or value.

### 13. Modification of Services

Telegram may modify Bot Platform anytime at its sole discretion without notice or liability. Developers are responsible for TPA availability and compatibility. Changes include altering, suspending, or discontinuing features; introducing new limitations or rules; imposing access restrictions; or restricting user access to specific TPAs.

### 14. Changes to Bot Developer Terms

Telegram may update Bot Developer Terms anytime. Changes become effective when posted at [https://telegram.org/tos/bot-developers](https://telegram.org/tos/bot-developers). Developers should check frequently and subscribe to [@BotNews](https://t.me/botnews) for updates.
