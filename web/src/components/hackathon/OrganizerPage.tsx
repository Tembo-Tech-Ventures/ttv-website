/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The diagram scroll region must support keyboard scrolling. */
import React from "react";

export const sections = [
  ["why", "Why"],
  ["journeys", "Who it serves"],
  ["weekend", "What we built"],
  ["architecture", "Architecture"],
  ["team", "How agents worked"],
  ["evidence", "Evidence & limits"],
] as const;

function Diagram({
  name,
  title,
  children,
}: {
  name: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="hack-diagram">
      <section
        className={`hack-diagram-scroll ${name === "architecture" ? "hack-diagram-wide" : ""}`}
        tabIndex={0}
        aria-label={title}
      >
        <img src={`/hackathon/${name}.svg`} alt={title} loading="lazy" />
      </section>
      <figcaption>
        <p>{children}</p>
        <a href={`/hackathon/${name}.svg`}>View full diagram</a> ·{" "}
        <a href={`/hackathon/${name}.mmd`}>Source</a>
      </figcaption>
    </figure>
  );
}

export default function OrganizerPage() {
  return (
    <div className="hack-page" id="top">
      <a className="hack-skip" href="#hack-content">
        Skip to the project story
      </a>
      <div className="hack-brand">
        <span>
          TEMBO <small>Tech Ventures</small>
        </span>
        <span>Codex Paris · 2026</span>
      </div>
      <header className="hack-hero">
        <p className="hack-eyebrow">A community prototype · 24–25 October</p>
        <h1>
          Show what
          <br />
          <em>you can do.</em>
        </h1>
        <p className="hack-lead">
          Work, sources and specific mentor confirmations help people explain
          why they merit a conversation.
        </p>
        <div className="hack-hero-bottom">
          <a className="hack-button" href="#journeys">
            See the journeys <span aria-hidden="true">↘</span>
          </a>
          <p>
            Organizer overview
            <br />
            <span>Read-only · Restricted staging prototype</span>
          </p>
        </div>
      </header>
      <div className="hack-layout">
        <aside className="hack-toc">
          <nav aria-label="On this page">
            <p className="hack-eyebrow">Inside the build</p>
            <ol>
              {sections.map(([id, label], index) => (
                <li key={id}>
                  <a href={`#${id}`}>
                    <span aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
        <main id="hack-content" className="hack-story">
          <section id="why">
            <p className="hack-eyebrow">01 / Why</p>
            <h2>Beyond a certificate.</h2>
            <p>
              “I have worked with students and alumni in Kenya and Nigeria. I
              want them to find local mentors and show abilities that a
              certificate or a list of technical skills can miss.”
            </p>
            <p className="hack-note">Raph, TTV founder</p>
            <p>
              During a visit to Kenya, two angel investors involved in education
              described the same gap: demonstrating financial literacy, selling
              and communication alongside programming.
            </p>
            <p>
              TTV aims to develop a tech community for people without
              established networks. Hiring is our first demonstration.
            </p>
          </section>
          <section id="journeys">
            <p className="hack-eyebrow">02 / Who</p>
            <h2>Three connected journeys.</h2>
            <div className="hack-journeys">
              <article>
                <span className="hack-number">01</span>
                <h3>Members</h3>
                <p>
                  Publish contributions and sources. Keep drafts private. Update
                  the story as the work changes.
                </p>
                <details className="hack-reveal">
                  <summary>See the member example</summary>
                  <figure className="hack-screen">
                    <a
                      href="/hackathon/member-contribution.webp"
                      aria-label="View full member example"
                    >
                      <img
                        src="/hackathon/member-contribution.webp"
                        width="1920"
                        height="1080"
                        loading="lazy"
                        alt="Journey page for fictional David Wanjiku showing a saved contribution and member-attached source, with no confirmation recorded."
                      />
                    </a>
                    <figcaption>
                      A member’s contribution with its source, marked
                      member-reported until someone checks it.
                    </figcaption>
                  </figure>
                </details>
              </article>
              <article>
                <span className="hack-number">02</span>
                <h3>Mentors</h3>
                <p>
                  Record what they checked on a specific contribution revision.
                  This does not certify every skill or claim.
                </p>
                <details className="hack-reveal">
                  <summary>See the mentor example</summary>
                  <figure className="hack-screen">
                    <a
                      href="/hackathon/mentor-confirmation.webp"
                      aria-label="View full mentor example"
                    >
                      <img
                        src="/hackathon/mentor-confirmation.webp"
                        width="1920"
                        height="1080"
                        loading="lazy"
                        alt="Confirmation history showing fictional mentor Amina Wanjiku’s statement and method, attached to claim revision 1."
                      />
                    </a>
                    <figcaption>
                      A mentor records what they personally checked, attached to
                      that revision, not to the whole person.
                    </figcaption>
                  </figure>
                </details>
              </article>
              <article>
                <span className="hack-number">03</span>
                <h3>Institutions</h3>
                <p>
                  Find eligible members, inspect claims, sources and
                  confirmations, then ask evidence-grounded questions.
                </p>
                <details className="hack-reveal">
                  <summary>See the institution example</summary>
                  <figure className="hack-screen">
                    <a
                      href="/hackathon/institution-evidence.webp"
                      aria-label="View full institution example"
                    >
                      <img
                        src="/hackathon/institution-evidence.webp"
                        width="1920"
                        height="1080"
                        loading="lazy"
                        alt="Fictional David Wanjiku’s contribution, source and mentor confirmation. Optional assessment and chat tools are visible but not in use."
                      />
                    </a>
                    <figcaption>
                      An approved institution reads the claim, the source and
                      the scoped confirmation; people decide.
                    </figcaption>
                  </figure>
                </details>
              </article>
            </div>
            <p className="hack-note">
              Staging demo (build aab6b3e, 25 Oct 2026). Fictional personas and
              data. Expand an example; select its image to view full size.
            </p>
            <Diagram
              name="journeys"
              title="Member, mentor and institution journeys with admin role approval"
            >
              Admins grant roles. TTV's relationship-based mentor validation and
              manual institution onboarding are operating policy; automated
              credential verification is not implemented.
            </Diagram>
            <p className="hack-note">
              Roles can overlap. A member with institutional access remains a
              member.
            </p>
          </section>
          <section id="weekend">
            <p className="hack-eyebrow">03 / Scope</p>
            <h2>Built on TTV.</h2>
            <div className="hack-columns">
              <article className="hack-card">
                <p className="hack-tag">Already existed</p>
                <h3>The platform</h3>
                <p>
                  Cohort learning and public builder profiles, supported by the
                  existing TTV website.
                </p>
              </article>
              <article className="hack-card hack-card-accent">
                <p className="hack-tag">Built this weekend</p>
                <h3>The community layer</h3>
                <p>
                  Community profiles and contribution histories, specific mentor
                  confirmations, institutional evidence discovery and dedicated
                  participation pages.
                </p>
              </article>
            </div>
          </section>
          <section id="architecture">
            <p className="hack-eyebrow">04 / Architecture</p>
            <h2>Evidence stays attached.</h2>
            <Diagram
              name="architecture"
              title="Web and MCP use shared authorized services, D1 and optional model routes"
            >
              Astro and React run on Cloudflare Workers. Web and MCP share
              access rules. D1 holds community records; source links preserve
              provenance. Private recordings are outside institutional
              discovery.
            </Diagram>
            <details className="hack-reveal">
              <summary>How search and optional AI differ</summary>
              <p>
                Directory search uses literal text matching and AND across exact
                skill tags. Optional GLM comparison examines a bounded result
                set. It is not semantic search or a ranking of all members.
              </p>
              <p>
                Mastra chat uses GLM 5.3 Flash; evidence assessment uses Gemma
                4. Both use Cloudflare AI Gateway. Ratings describe evidence
                support. Missing evidence stays unknown.
              </p>
            </details>
          </section>
          <section id="team">
            <p className="hack-eyebrow">05 / Process</p>
            <h2>
              Human direction.
              <br />
              Bounded agent work.
            </h2>
            <p>
              Raph directed a mixed-model team: Codex agents for product,
              architecture, development, design and marketing; Opus for manual
              QA; a separate editorial pass.
            </p>
            <p>
              Explicit ownership, small patches and one integration branch
              helped. Repeated access setup and late handoffs showed where
              reusable tools are still needed.
            </p>
            <p className="hack-note">
              Codex was a development tool. Future OpenAI runtime integration
              and evaluation remain separate work.
            </p>
          </section>
          <section id="evidence">
            <p className="hack-eyebrow">06 / Evidence & limits</p>
            <h2>Tested, with gaps.</h2>
            <p>
              18 live directory checks covered expected results, ordering and
              access boundaries. Fictional persona journeys were reviewed on
              desktop and mobile. These checks do not establish hiring outcomes
              or model quality.
            </p>
            <p>
              Citation attribution and unsupported ordering failed during QA.
              Code fixes do not establish fresh model-quality validation. The
              Kotlin comparison produced equivalent evidence, not a validated
              quality ranking.
            </p>
            <p>
              Institution grouping, official certification attestations and
              semantic matching remain future work. Interactive access is
              restricted.
            </p>
            <p className="hack-note">
              <a href="https://github.com/Tembo-Tech-Ventures/ttv-website/issues/170#issuecomment-6396855720">
                Directory verification evidence
              </a>{" "}
              ·{" "}
              <a href="https://github.com/Tembo-Tech-Ventures/ttv-website/pull/207">
                Weekend scope
              </a>
            </p>
          </section>
        </main>
      </div>
      <footer className="hack-end">
        <span>TEMBO TECH VENTURES</span>
        <a href="#top">Back to the beginning ↑</a>
      </footer>
    </div>
  );
}
