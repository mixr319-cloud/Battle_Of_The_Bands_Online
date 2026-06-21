import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";

interface Props {
  open: boolean;
  onClose: () => void;
}

type LegalTab = "privacy" | "terms" | "contact";

const ACCENT = "#a855f7";
const LAST_UPDATED = "June 21, 2026";
const SUPPORT_EMAIL = "help.battleofthebands@gmail.com";

const TABS: { id: LegalTab; label: string }[] = [
  { id: "privacy", label: "Privacy Policy" },
  { id: "terms", label: "Terms of Service" },
  { id: "contact", label: "Contact" },
];

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-white font-bold text-sm mb-1.5">{heading}</h3>
      <div className="text-white/60 text-sm leading-relaxed space-y-2">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function PrivacyContent() {
  return (
    <>
      <p className="text-white/35 text-xs mb-5">Last updated {LAST_UPDATED}</p>

      <Section heading="Overview">
        <p>
          Battle of the Bands ("we," "us," "our") is a real-time multiplayer music battle game.
          This Privacy Policy explains what information we collect when you play, how we use it,
          and the choices you have.
        </p>
      </Section>

      <Section heading="Information We Collect">
        <p><strong className="text-white/80">Account information.</strong> When you create an account we collect a username, display name, and avatar color. If you sign in with Discord or Google, we receive a unique ID and basic profile details from that provider — we never see or store your password. If you play as a guest, a profile is generated and kept in your browser unless you later link it to an account.</p>
        <p><strong className="text-white/80">Gameplay & stats.</strong> Your level, XP, win/loss record, MVP count, and match history (genre, team size, teammates, and outcome).</p>
        <p><strong className="text-white/80">Audio recordings.</strong> When you record a verse, beat, or freestyle during a match, that audio is uploaded to our servers so it can be played back to your team and the opposing team for live voting, and is stored as part of the match.</p>
        <p><strong className="text-white/80">Local storage.</strong> A copy of your profile is cached in your browser's local storage so the game loads faster and remembers who you are between sessions.</p>
        <p>We do not currently use third-party advertising or analytics services. If that changes, we'll update this policy.</p>
      </Section>

      <Section heading="How We Use Your Information">
        <Bullets items={[
          "Run matchmaking, live battles, and voting",
          "Track XP, levels, and stats",
          "Maintain, secure, and improve the game",
          "Respond when you contact us",
          "Enforce our Terms of Service and keep matches safe",
        ]} />
      </Section>

      <Section heading="About Your Recordings">
        <p>
          Audio you record during a match is core to gameplay — it's played for your team and
          opponents so everyone can vote on a winner. Because this is voice data, please avoid
          including personal details (your real name, address, phone number, etc.) in a
          recording. Recordings are kept as part of match history unless removed; you can request
          deletion at any time — see "Your Choices" below.
        </p>
      </Section>

      <Section heading="Sharing of Information">
        <Bullets items={[
          "Discord or Google only receive what's needed to verify your login.",
          "Recordings are shared with the other players in your match by design, so voting works.",
          "We do not sell your personal information or share it with advertisers.",
          "We may disclose information if required to by law.",
        ]} />
      </Section>

      <Section heading="Data Retention">
        <p>
          Account information is kept for as long as your account exists. Match recordings are
          kept as part of match history. You can request deletion of your account and/or
          recordings at any time by contacting us.
        </p>
      </Section>

      <Section heading="Children's Privacy">
        <p>
          Battle of the Bands is not directed to children under 13, and we don't knowingly
          collect information from them. If you believe a child has created an account, contact
          us and we'll remove it.
        </p>
      </Section>

      <Section heading="Your Choices & Rights">
        <Bullets items={[
          "Delete your account and associated data",
          "Request a copy of the data we hold about you",
          "Play as a guest to minimize what's shared",
          "Depending on where you live, you may have additional rights (e.g. access, correction, deletion) under laws like the GDPR or CCPA",
        ]} />
      </Section>

      <Section heading="Security">
        <p>
          We use reasonable measures to protect your information, but no online service can
          guarantee perfect security.
        </p>
      </Section>

      <Section heading="Changes to This Policy">
        <p>
          We may update this policy from time to time. The "Last updated" date above reflects the
          most recent revision.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about this policy or your data? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: ACCENT }}>
            {SUPPORT_EMAIL}
          </a>.
        </p>
      </Section>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <p className="text-white/35 text-xs mb-5">Last updated {LAST_UPDATED}</p>

      <Section heading="1. Acceptance of Terms">
        <p>
          By creating an account or playing Battle of the Bands, you agree to these Terms of
          Service. If you don't agree, please don't use the game.
        </p>
      </Section>

      <Section heading="2. Eligibility">
        <p>
          You must be at least 13 years old to use Battle of the Bands. If you're under 18, you
          should have a parent or guardian's permission.
        </p>
      </Section>

      <Section heading="3. Accounts">
        <p>
          You can play as a guest or sign in with Discord or Google. You're responsible for
          activity that happens under your account and for keeping your login secure.
        </p>
      </Section>

      <Section heading="4. Code of Conduct">
        <p>Because matches involve live, recorded audio with other real players, you agree not to:</p>
        <Bullets items={[
          "Use hate speech, slurs, harassment, or threats",
          "Share sexual, violent, or otherwise explicit content",
          "Impersonate others or share someone else's personal information",
          "Cheat, exploit bugs, or use bots/macros",
          "Spam or otherwise disrupt matches",
        ]} />
        <p>We may remove content, recordings, or suspend or ban accounts that violate this Code of Conduct.</p>
      </Section>

      <Section heading="5. User Content & License">
        <p>
          You keep ownership of the audio you record. By recording in a match, you grant us a
          non-exclusive, royalty-free, worldwide license to store, reproduce, and play back that
          recording within the game for matches, voting, and match history. We may remove content
          that violates these Terms.
        </p>
      </Section>

      <Section heading="6. Intellectual Property">
        <p>
          The Battle of the Bands name, logo, artwork, characters, and code are owned by us (or
          licensed to us) and protected by copyright and trademark law. Don't copy, redistribute,
          or create derivative works without our permission.
        </p>
      </Section>

      <Section heading="7. Prohibited Activities">
        <Bullets items={[
          "Reverse engineering, decompiling, or scraping the game or its servers",
          "Attacking, overloading, or disrupting our infrastructure",
          "Reselling or transferring access to the game without permission",
          "Any use that violates applicable law",
        ]} />
      </Section>

      <Section heading="8. Termination">
        <p>
          We may suspend or terminate accounts that violate these Terms. You're free to stop
          playing and delete your account at any time.
        </p>
      </Section>

      <Section heading="9. Disclaimers">
        <p>
          Battle of the Bands is provided "as is," without warranties of any kind. We don't
          guarantee the game will be uninterrupted, error-free, or available at all times.
        </p>
      </Section>

      <Section heading="10. Limitation of Liability">
        <p>
          To the fullest extent permitted by law, we are not liable for any indirect, incidental,
          or consequential damages arising from your use of the game.
        </p>
      </Section>

      <Section heading="11. Changes to These Terms">
        <p>
          We may update these Terms from time to time. Continuing to use the game after changes
          means you accept the updated Terms.
        </p>
      </Section>

      <Section heading="12. Contact">
        <p>
          Questions about these Terms? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: ACCENT }}>
            {SUPPORT_EMAIL}
          </a>.
        </p>
      </Section>
    </>
  );
}

function ContactContent() {
  return (
    <>
      <Section heading="Get in Touch">
        <p>
          Have a bug to report, a question, or feedback about Battle of the Bands? We'd love to
          hear from you.
        </p>
      </Section>

      <div
        className="rounded-xl p-4 mb-5 flex items-center justify-between gap-3"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}
      >
        <div>
          <div className="text-white/40 text-xs uppercase tracking-widest mb-1">Email</div>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold" style={{ color: ACCENT }}>
            {SUPPORT_EMAIL}
          </a>
        </div>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="px-4 py-2 rounded-xl text-sm font-bold text-white shrink-0 transition-all active:scale-95"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #6366f1)`, boxShadow: `0 0 20px ${ACCENT}44` }}
        >
          Email Us
        </a>
      </div>

      <Section heading="What to Reach Out About">
        <Bullets items={[
          "Bug reports or technical issues",
          "General feedback or business inquiries",
        ]} />
      </Section>
    </>
  );
}

export function LegalModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<LegalTab>("privacy");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="legal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
          style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(18px)" }}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.93, opacity: 0, y: 28 }}
            animate={{ scale: 1, opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 26 } }}
            exit={{ scale: 0.95, opacity: 0, y: 20, transition: { duration: 0.2 } }}
            className="relative w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
            style={{
              background: "rgba(10, 7, 22, 0.97)",
              border: `1px solid ${ACCENT}44`,
              boxShadow: `0 0 60px ${ACCENT}22, 0 40px 80px rgba(0,0,0,0.85)`,
              maxHeight: "85vh",
            }}
          >
            {/* Top accent line */}
            <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)` }} />

            {/* Header bar */}
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-sm tracking-wide">BATTLE OF THE BANDS</span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: `${ACCENT}22`, color: ACCENT, border: `1px solid ${ACCENT}44` }}
                >
                  Legal
                </span>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 transition-colors"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 px-5 pt-4 pb-2 shrink-0">
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-95"
                    style={{
                      background: active ? `${ACCENT}22` : "rgba(255,255,255,0.04)",
                      border: active ? `1px solid ${ACCENT}66` : "1px solid rgba(255,255,255,0.08)",
                      color: active ? ACCENT : "rgba(255,255,255,0.45)",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Scrollable content */}
            <div className="px-5 pb-5 pt-2 overflow-y-auto">
              {tab === "privacy" && <PrivacyContent />}
              {tab === "terms" && <TermsContent />}
              {tab === "contact" && <ContactContent />}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
