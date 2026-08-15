"use client";

/**
 * UI playground (/dev/ui) — client-side primitive showcase.
 *
 * The primitives live in `src/components/ui/` and are imported via the
 * `@/components/ui` barrel. This file is just the showcase page — one section
 * per primitive, exercising its interaction states. The shared CSS (tokens,
 * selectors, reduced-motion rules) is loaded by the barrel import below.
 *
 * Deliberately DESCRIPTION-FREE (Sam, 2026-07-29): the sections used to carry
 * explanatory prose inherited from secretless, most of it describing product
 * concepts this app does not have, and some of it stale about the design system
 * itself (it still promised a "blue glow" after the accent became teal). A
 * heading plus the live component is the whole point of the page; prose here
 * just rots. Demo strings are structural filler, not product claims.
 */

import { useState } from "react";
import {
  ActionButton,
  AppBar,
  Badge,
  Card,
  CardStack,
  Checkbox,
  Divider,
  DropdownButton,
  DropdownMenu,
  IconButton,
  IconWell,
  LiftText,
  LinkText,
  Navbar,
  PrimaryButton,
  ProConCard,
  SearchBar,
  Secredit,
  StarRating,
  StatBar,
  SubHeader,
  Switch,
  TabBar,
  TextField,
  Toggle,
  VoteButton,
} from "@/components/ui";

import { PaletteReference } from "./palette-reference";

// ---------------------------------------------------------------------------
// Page body
// ---------------------------------------------------------------------------

/* Category tabs. The page is categorised with the app's OWN TabBar rather than
   with static headings — dogfooding, and it means a TabBar regression is
   impossible to miss because the page you are inspecting stops working.
   Labels are kept short so all eight fit at the default (non-`compact`) size.
   Palette is first and is the default tab: it is the reference the rest of the
   page is judged against. */
const CATEGORIES = [
  { id: "palette", label: "Palette" },
  { id: "buttons", label: "Buttons" },
  { id: "inputs", label: "Inputs" },
  { id: "surfaces", label: "Surfaces" },
  { id: "chrome", label: "Chrome" },
  { id: "data", label: "Data" },
  { id: "type", label: "Type" },
  { id: "currency", label: "Currency" },
];

const GLOW_GENERAL = false;
const GLOW_SEARCH = true;

export function UIPlayground() {
  const [cat, setCat] = useState<string>("palette");
  const [toggleValue, setToggleValue] = useState<string>("signin");
  const [stressToggle, setStressToggle] = useState<string>("a");
  const [activeTab3, setActiveTab3] = useState<string>("overview");
  const [activeTab5, setActiveTab5] = useState<string>("overview");
  const [activeNav, setActiveNav] = useState<string>("dashboard");
  const [switchValue, setSwitchValue] = useState<boolean>(false);
  const [check1, setCheck1] = useState<boolean>(false);
  const [check2, setCheck2] = useState<boolean>(true);
  const [fieldName, setFieldName] = useState<string>("");
  const [fieldEmail, setFieldEmail] = useState<string>("");
  const [vote1, setVote1] = useState<"up" | "down" | null>(null);
  const [vote2, setVote2] = useState<"up" | "down" | null>("up");
  const [vote3, setVote3] = useState<"up" | "down" | null>("down");
  const [copied, setCopied] = useState(false);
  const [copiedStandalone, setCopiedStandalone] = useState(false);
  const [sortValue, setSortValue] = useState<string>("newest");
  const sortLabel = ({
    newest: "Newest",
    oldest: "Oldest",
    rating: "Top Rated",
    relevant: "Relevant",
  } as Record<string, string>)[sortValue] ?? "Newest";

  return (
    <div
      className="ui-playground"
      data-glow-general={GLOW_GENERAL || undefined}
      data-glow-search={GLOW_SEARCH || undefined}
    >
      <header className="ui-playground-header">
        <h1>UI Playground</h1>
      </header>

      {/* Not `compact`: that prop exists for constrained surfaces (a ~500px
          modal) where the longest label would ellipsize, and it drops labels to
          0.72rem. This bar is 912px wide for seven short labels — roughly 130px
          each — so the default 0.875rem fits with room to spare. */}
      <div className="ui-playground-tabs">
        <TabBar tabs={CATEGORIES} value={cat} onChange={setCat} />
      </div>

      {cat === "palette" && (
        <>
      <section className="ui-playground-section">
        <h2>Palette</h2>
        <PaletteReference />
      </section>
        </>
      )}

      {cat === "buttons" && (
        <>

      <section className="ui-playground-section">
        <h2>§3.1 Primary Button</h2>
        <div className="ui-playground-grid">
          <PrimaryButton label="Continue" />
          <PrimaryButton label="Continue with Star" icon={<StarIcon />} />
          <PrimaryButton
            label="Continue with Bulge"
            icon={<StarIcon />}
            iconWellVariant="bulge"
          />
          <PrimaryButton label="Disabled" disabled />
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.20 Action Button</h2>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <ActionButton
            label="Open booking page"
            color="var(--primary)"
            textColor="#fff"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            }
            href="https://example.com"
            external
          />
          <ActionButton
            label="Premium action"
            color="var(--brand-accent)"
            textColor="var(--brand-accent-foreground)"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 15 12 9 18 15" /></svg>
            }
          />
          <ActionButton label="Confirm" color="var(--color-success)" textColor="#fff" />
          <ActionButton label="Disabled" color="var(--primary)" textColor="#fff" disabled />
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.3 Icon Well + Icon Button</h2>
        <div className="ui-playground-grid">
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <IconWell variant="recess"><StarIcon /></IconWell>
            <IconWell variant="card"><StarIcon /></IconWell>
            <IconButton label="Star action"><StarIcon /></IconButton>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <IconWell variant="recess" size={44}><SparkleIcon /></IconWell>
            <IconWell variant="card" size={44}><SparkleIcon /></IconWell>
            <IconButton size={44} label="Sparkle action"><SparkleIcon /></IconButton>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <IconWell variant="recess" size={28}><StarIcon /></IconWell>
            <IconWell variant="card" size={28}><StarIcon /></IconWell>
            <IconButton size={28} label="Small action"><StarIcon /></IconButton>
            <IconButton size={28} disabled label="Disabled"><SparkleIcon /></IconButton>
          </div>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.19 Copy Button</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 320 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <LinkText href="mailto:support@myadventurealerts.com">support@myadventurealerts.com</LinkText>
            <IconButton
              size={28}
              label={copied ? "Copied to clipboard" : "Copy to clipboard"}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText("support@myadventurealerts.com");
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                } catch { /* silent */ }
              }}
              iconKey={copied ? "check" : "copy"}
              asideLabel={copied ? "Copied" : null}
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </IconButton>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <span style={{ fontSize: "0.875rem", color: "var(--ui-text-dim)" }}>Standalone (no link)</span>
            <IconButton
              size={28}
              label={copiedStandalone ? "Copied" : "Copy sample text"}
              onClick={() => {
                navigator.clipboard.writeText("Hello from the playground").catch(() => {});
                setCopiedStandalone(true);
                window.setTimeout(() => setCopiedStandalone(false), 1500);
              }}
              iconKey={copiedStandalone ? "check-2" : "copy-2"}
              asideLabel={copiedStandalone ? "Copied" : null}
            >
              {copiedStandalone ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </IconButton>
          </div>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.16 Vote Button</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Standalone</h3>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <VoteButton direction="up" count={12} />
              <VoteButton direction="down" count={3} />
              <VoteButton direction="up" active count={7} />
              <VoteButton direction="down" active count={2} />
              <VoteButton direction="up" disabled />
            </div>
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Pro/con usage</h3>
            <Card>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <VoteButton
                      direction="up"
                      active={vote1 === "up"}
                      count={vote1 === "up" ? 13 : 12}
                      onClick={() => setVote1(vote1 === "up" ? null : "up")}
                    />
                    <VoteButton
                      direction="down"
                      active={vote1 === "down"}
                      count={vote1 === "down" ? 4 : 3}
                      onClick={() => setVote1(vote1 === "down" ? null : "down")}
                    />
                  </div>
                  <span style={{ fontSize: "0.8125rem" }}>A statement long enough to sit beside the control</span>
                  <Badge label="Community" variant="community" dot />
                </div>
                <Divider variant="recess" />
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <VoteButton
                      direction="up"
                      active={vote2 === "up"}
                      count={vote2 === "up" ? 8 : 7}
                      onClick={() => setVote2(vote2 === "up" ? null : "up")}
                    />
                    <VoteButton
                      direction="down"
                      active={vote2 === "down"}
                      count={vote2 === "down" ? 2 : 1}
                      onClick={() => setVote2(vote2 === "down" ? null : "down")}
                    />
                  </div>
                  <span style={{ fontSize: "0.8125rem" }}>A second statement, this one upvoted</span>
                  <Badge label="Expert" variant="expert" dot />
                </div>
                <Divider variant="recess" />
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <VoteButton
                      direction="up"
                      active={vote3 === "up"}
                      count={vote3 === "up" ? 6 : 5}
                      onClick={() => setVote3(vote3 === "up" ? null : "up")}
                    />
                    <VoteButton
                      direction="down"
                      active={vote3 === "down"}
                      count={vote3 === "down" ? 10 : 9}
                      onClick={() => setVote3(vote3 === "down" ? null : "down")}
                    />
                  </div>
                  <span style={{ fontSize: "0.8125rem" }}>A third statement, this one downvoted</span>
                  <Badge label="Marketplace" variant="marketplace" dot />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>
        </>
      )}

      {cat === "inputs" && (
        <>

      <section className="ui-playground-section">
        <h2>§3.2 Toggle</h2>
        <div className="ui-playground-grid ui-playground-grid--narrow">
          <Toggle
            options={[
              { id: "signin", label: "Sign In" },
              { id: "signup", label: "Sign Up" },
            ]}
            value={toggleValue}
            onChange={setToggleValue}
          />
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.11 Switch</h2>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <Switch value={switchValue} onChange={setSwitchValue} />
          <span style={{ fontSize: "0.8125rem", color: "var(--ui-text-dim)" }}>
            {switchValue ? "On" : "Off"}
          </span>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.13 Checkbox</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Checkbox label="Accept terms" checked={check1} onChange={setCheck1} />
          <Checkbox label="Subscribe to updates" checked={check2} onChange={setCheck2} />
          <Checkbox label="Disabled unchecked" checked={false} onChange={() => {}} disabled />
          <Checkbox label="Disabled checked" checked={true} onChange={() => {}} disabled />
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.12 Text Field</h2>
        <div
          className="ui-playground-grid"
          style={{ maxWidth: 320, gap: "1rem" }}
        >
          <TextField
            label="Full name"
            placeholder="Jane Doe"
            value={fieldName}
            onChange={setFieldName}
          />
          <TextField
            label="Email"
            type="email"
            placeholder="jane@example.com"
            value={fieldEmail}
            onChange={setFieldEmail}
          />
          <TextField label="Disabled" placeholder="can't type here" disabled />
          <TextField
            label="Multiline"
            placeholder="Be specific. Let us know what you would like to see."
            multiline
            rows={4}
          />
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.4 Search Bar</h2>
        <div className="ui-playground-grid">
          <SearchBar />
          <SearchBar placeholder="Search…" />
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.10 Dropdown Button</h2>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <DropdownButton
            label={`Sort: ${sortLabel}`}
            items={[
              { id: "newest", label: "Newest First" },
              { id: "oldest", label: "Oldest First" },
              { id: "rating", label: "Highest Rated" },
              { id: "relevant", label: "Most Relevant" },
            ]}
            onSelect={setSortValue}
          />
          <DropdownButton
            label="Actions"
            minWidth={160}
            items={[
              { id: "edit", label: "Edit", icon: <StarIcon /> },
              { id: "duplicate", label: "Duplicate", icon: <SparkleIcon /> },
              { id: "divider", label: "", divider: true },
              { id: "delete", label: "Delete" },
            ]}
            onSelect={() => {}}
          />
          <DropdownButton label="Disabled" disabled items={[]} onSelect={() => {}} />
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.9 Dropdown Menu</h2>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          <DropdownMenu
            items={[
              { id: "profile", label: "Profile", icon: <StarIcon /> },
              { id: "settings", label: "Settings", icon: <SparkleIcon /> },
              { id: "divider", label: "", divider: true },
              { id: "signout", label: "Sign Out" },
            ]}
            onSelect={() => {}}
          />
          <DropdownMenu
            items={[
              { id: "newest", label: "Newest First" },
              { id: "oldest", label: "Oldest First" },
              { id: "rating", label: "Highest Rated" },
              { id: "relevant", label: "Most Relevant" },
            ]}
            onSelect={() => {}}
          />
        </div>
      </section>
        </>
      )}

      {cat === "surfaces" && (
        <>

      <section className="ui-playground-section">
        <h2>§3.5 Card</h2>
        <div className="ui-playground-grid" style={{ maxWidth: 400 }}>
          <Card>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem", fontWeight: 700 }}>
              Card title
            </h3>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--ui-text-dim)", lineHeight: 1.5 }}>
              Body copy inside a card. The card surface shares the button
              gradient so it reads as the same material.
            </p>
          </Card>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <IconWell variant="recess" size={40}>
                <StarIcon />
              </IconWell>
              <div>
                <h3 style={{ margin: "0 0 0.25rem", fontSize: "1rem", fontWeight: 700 }}>
                  With Icon Well
                </h3>
                <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--ui-text-dim)" }}>
                  Recess well embedded in a convex card.
                </p>
              </div>
            </div>
          </Card>
          <Card>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem", fontWeight: 700 }}>
              Nested Cards
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <Card>
                <p style={{ margin: 0, fontSize: "0.8125rem" }}>Inner card A</p>
              </Card>
              <Card>
                <p style={{ margin: 0, fontSize: "0.8125rem" }}>Inner card B</p>
              </Card>
            </div>
          </Card>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.5b SubHeader</h2>
        <div
          style={{
            background: "var(--background)",
            borderRadius: 8,
            paddingTop: 24,
            paddingBottom: 8,
          }}
        >
          <SubHeader>Page Title</SubHeader>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.21 Card Stack</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem", maxWidth: 440 }}>
          <div>
            <h3 style={{ margin: "0 0 1rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Full taxonomy path</h3>
            <CardStack
              levels={[
                { label: "Domain", meta: "Audio" },
                { label: "Class", meta: "Over-ear Headphones" },
                { label: "Brand", meta: "Sony" },
                { label: "Line", meta: "WH-1000X" },
                { label: "Model", meta: "WH-1000XM5" },
              ]}
            >
              <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                <Badge label="ANC" variant="default" size="sm" />
                <Badge label="Wireless" variant="default" size="sm" />
                <Badge label="Bluetooth" variant="default" size="sm" />
              </div>
            </CardStack>
          </div>
          <div>
            <h3 style={{ margin: "0 0 1rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Skincare path</h3>
            <CardStack
              levels={[
                { label: "Domain", meta: "Skincare" },
                { label: "Class", meta: "Moisturizer" },
                { label: "Brand", meta: "CeraVe" },
                { label: "Model", meta: "Moisturizing Cream" },
              ]}
            >
              <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                <Badge label="Fragrance-Free" variant="default" size="sm" />
                <Badge label="Ceramide" variant="default" size="sm" />
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--ui-text-dim)" }}>3oz · 12oz · 19oz</div>
            </CardStack>
          </div>
          <div>
            <h3 style={{ margin: "0 0 1rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Software — short stack</h3>
            <CardStack
              levels={[
                { label: "Domain", meta: "Creative Software" },
                { label: "Class", meta: "3D Animation Suite" },
                { label: "Model", meta: "Autodesk Maya" },
              ]}
            />
          </div>
          <div>
            <h3 style={{ margin: "0 0 1rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>With bottom content</h3>
            <CardStack
              levels={[
                { label: "Domain", meta: "Automotive" },
                { label: "Class", meta: "Tires" },
                { label: "Brand", meta: "Michelin" },
                { label: "Model", meta: "Pilot Sport 4S" },
              ]}
            >
              <StatBar label="Score" value={78} displayValue="5.5 / 7" color="var(--brand-accent)" />
            </CardStack>
          </div>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.5b Card Tier Stress Test</h2>
        <Card>
          <h3 style={{ margin: "0 0 1rem", fontSize: "1.125rem", fontWeight: 700 }}>
            Tier 1 — Kitchen Sink
          </h3>

          {/* Buttons row */}
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
            <PrimaryButton label="Action" icon={<StarIcon />} />
            <PrimaryButton label="Disabled" icon={<SparkleIcon />} disabled />
          </div>

          {/* Search bar on card */}
          <div style={{ marginBottom: "1.25rem" }}>
            <SearchBar placeholder="Search on a card..." />
          </div>

          {/* Icon wells row — right-aligned with even spacing */}
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginBottom: "1.25rem" }}>
            <IconWell variant="recess" size={40}><StarIcon /></IconWell>
            <IconWell variant="card" size={40}><SparkleIcon /></IconWell>
            <IconWell variant="recess" size={40}><SparkleIcon /></IconWell>
          </div>

          {/* Toggle on card */}
          <div style={{ maxWidth: 240, marginBottom: "1.25rem" }}>
            <Toggle
              options={[{ id: "a", label: "Option A" }, { id: "b", label: "Option B" }]}
              value={stressToggle}
              onChange={setStressToggle}
            />
          </div>

          {/* T2 nested cards */}
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <Card>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9375rem", fontWeight: 700 }}>
                Tier 2 — With Components
              </h3>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                <PrimaryButton label="T2 Button" icon={<StarIcon />} />
              </div>
              <div style={{ marginBottom: "0.75rem" }}>
                <SearchBar placeholder="Search on T2..." />
              </div>
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
                <IconWell variant="recess" size={36}><StarIcon /></IconWell>
                <IconWell variant="card" size={36}><SparkleIcon /></IconWell>
              </div>

              {/* T3 inside T2 */}
              <Card>
                <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.875rem", fontWeight: 700 }}>
                  Tier 3 — Deepest
                </h3>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                  <PrimaryButton label="T3 Btn" icon={<SparkleIcon />} />
                </div>
                <div style={{ marginBottom: "0.75rem" }}>
                  <SearchBar placeholder="Search on T3..." />
                </div>
                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                  <IconWell variant="recess" size={32}><StarIcon /></IconWell>
                  <IconWell variant="card" size={32}><SparkleIcon /></IconWell>
                </div>
              </Card>
            </Card>

            <Card>
              <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.9375rem", fontWeight: 700 }}>
                Tier 2 — Text Only
              </h3>
              <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--ui-text-dim)", lineHeight: 1.5 }}>
                A plain T2 card next to one with components, to compare
                surface contrast side-by-side.
              </p>
            </Card>
          </div>
        </Card>
      </section>

      <section className="ui-playground-section">
        <h2>§3.6 Divider</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem", maxWidth: 400 }}>
          <div>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--ui-text-dim)" }}>Horizontal recess / ridge (on page)</p>
            <Divider variant="recess" />
            <div style={{ height: "0.5rem" }} />
            <Divider variant="ridge" />
          </div>
          <div>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--ui-text-dim)" }}>Vertical recess / ridge (on page)</p>
            <div style={{ display: "flex", alignItems: "stretch", gap: "1rem", height: 60 }}>
              <span style={{ fontSize: "0.8125rem", color: "var(--ui-text-dim)", alignSelf: "center" }}>Left</span>
              <Divider variant="recess" orientation="vertical" />
              <span style={{ fontSize: "0.8125rem", color: "var(--ui-text-dim)", alignSelf: "center" }}>Middle</span>
              <Divider variant="ridge" orientation="vertical" />
              <span style={{ fontSize: "0.8125rem", color: "var(--ui-text-dim)", alignSelf: "center" }}>Right</span>
            </div>
          </div>
          <Card>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", fontWeight: 700 }}>On a card</p>
            <Divider variant="recess" />
            <p style={{ margin: "0.75rem 0", fontSize: "0.8125rem", color: "var(--ui-text-dim)" }}>Content between dividers</p>
            <Divider variant="ridge" />
            <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--ui-text-dim)" }}>More content</p>
            <div style={{ height: "0.75rem" }} />
            <div style={{ display: "flex", alignItems: "stretch", gap: "0.75rem", height: 44 }}>
              <span style={{ fontSize: "0.8125rem", alignSelf: "center" }}>Col A</span>
              <Divider variant="recess" orientation="vertical" />
              <span style={{ fontSize: "0.8125rem", alignSelf: "center" }}>Col B</span>
              <Divider variant="ridge" orientation="vertical" />
              <span style={{ fontSize: "0.8125rem", alignSelf: "center" }}>Col C</span>
            </div>
          </Card>
        </div>
      </section>
        </>
      )}

      {cat === "chrome" && (
        <>

      <section className="ui-playground-section">
        <h2>§3.7 App Bar + Navbar</h2>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300, maxWidth: 480, display: "flex", flexDirection: "column", gap: "1rem" }}>
            <AppBar>
              <span style={{ fontWeight: 700, fontSize: "0.9375rem", marginRight: "auto" }}>Secret·less</span>
              <IconButton size={32} label="Search"><StarIcon /></IconButton>
              <IconButton size={32} label="Settings"><SparkleIcon /></IconButton>
            </AppBar>
            <AppBar>
              <span style={{ fontWeight: 700, fontSize: "0.9375rem" }}>App</span>
              <div style={{ flex: 1, margin: "0 0.75rem" }}>
                <SearchBar placeholder="Search..." />
              </div>
              <IconButton size={32} label="Menu"><SparkleIcon /></IconButton>
            </AppBar>
          </div>
          <div style={{ width: 200 }}>
            <Navbar
              items={[
                { id: "dashboard", label: "Dashboard", icon: <StarIcon /> },
                { id: "products", label: "Products", icon: <SparkleIcon /> },
                { id: "reviews", label: "Reviews", icon: <StarIcon /> },
                { id: "settings", label: "Settings", icon: <SparkleIcon /> },
              ]}
              value={activeNav}
              onChange={setActiveNav}
            />
          </div>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.8 Tab Bar</h2>
        <div style={{ maxWidth: 400 }}>
          <TabBar
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "reviews", label: "Reviews" },
              { id: "specs", label: "Specs" },
            ]}
            value={activeTab3}
            onChange={setActiveTab3}
          />
          <div style={{ height: "1rem" }} />
          <TabBar
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "reviews", label: "Reviews" },
              { id: "specs", label: "Specs" },
              { id: "compare", label: "Compare" },
              { id: "history", label: "History" },
            ]}
            value={activeTab5}
            onChange={setActiveTab5}
          />
        </div>
      </section>
        </>
      )}

      {cat === "data" && (
        <>

      <section className="ui-playground-section">
        <h2>§3.14 Stat Bar</h2>
        <div style={{ maxWidth: 360, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <StatBar label="Sentiment" value={72} />
          <StatBar label="Rating" value={84} displayValue="4.2 / 5" />
          <StatBar label="Consensus" value={45} />
          <StatBar label="Source coverage" value={100} displayValue="4 / 4" />
          <StatBar label="Confidence" value={28} displayValue="Low" height={8} />
        </div>

        <div style={{ marginTop: "2rem" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.9375rem", fontWeight: 700 }}>
            With accent colors
          </h3>
          <div style={{ maxWidth: 360, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <StatBar label="Community" value={90} color="var(--destructive)" />
            <StatBar label="Marketplace" value={65} color="var(--nav-anchor)" />
            <StatBar label="Expert" value={40} color="var(--brand-accent)" />
            <StatBar label="Hands-on" value={15} color="var(--color-success)" />
          </div>
        </div>

        <div style={{ marginTop: "2rem" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.9375rem", fontWeight: 700 }}>
            On a card
          </h3>
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <StatBar label="Build quality" value={88} />
              <StatBar label="Value for money" value={62} />
              <StatBar label="Durability" value={34} />
            </div>
          </Card>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.17 Star Rating</h2>
        <div style={{ maxWidth: 360, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <StarRating label="Rating" value={4.2} displayValue="4.2 / 5" />
          <StarRating label="Best Buy" value={3.7} />
          <StarRating label="Walmart" value={2.0} />
          <StarRating label="Target" value={5.0} displayValue="Perfect" />
          <StarRating label="Newegg" value={0.8} />
        </div>
        <div style={{ marginTop: "2rem" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.9375rem", fontWeight: 700 }}>
            With accent color
          </h3>
          <div style={{ maxWidth: 360, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <StarRating label="Community rating" value={4.5} color="var(--brand-accent)" />
            <StarRating label="Expert rating" value={3.2} color="var(--nav-anchor)" />
          </div>
        </div>
        <div style={{ marginTop: "2rem" }}>
          <h3 style={{ margin: "0 0 1rem", fontSize: "0.9375rem", fontWeight: 700 }}>
            On a card
          </h3>
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <StarRating label="Overall" value={4.1} />
              <StarRating label="Build quality" value={3.5} color="var(--color-success)" />
            </div>
          </Card>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.15 Badge</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Source categories</h3>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <Badge label="Community" variant="community" dot />
              <Badge label="Marketplace" variant="marketplace" dot />
              <Badge label="Expert" variant="expert" dot />
              <Badge label="Hands-on" variant="handson" dot />
            </div>
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Status / semantic</h3>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <Badge label="Verified" variant="success" />
              <Badge label="Low confidence" variant="warning" />
              <Badge label="Flagged" variant="danger" />
              <Badge label="Draft" />
            </div>
          </div>
          <div>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>On a card</h3>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <Badge label="Expert" variant="expert" dot />
                <Badge label="Verified" variant="success" />
              </div>
              <p style={{ margin: 0, fontSize: "0.8125rem" }}>
                Body copy sits here, beneath the badge row.
              </p>
            </Card>
          </div>
        </div>
        <div style={{ marginTop: "1.25rem" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Accent (any color + optional suffix)</h3>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <Badge label="Operated" variant="accent" color="var(--color-success)" suffix="0.7" />
            <Badge label="Worn" variant="accent" color="var(--brand-accent)" suffix="0.3" />
            <Badge label="Ingested" variant="accent" color="var(--destructive)" />
            <Badge label="Software" variant="accent" color="rgba(44, 34, 30, 0.55)" />
            <Badge label="Driven" variant="accent" color="var(--primary)" suffix="1.0" />
            <Badge label="Built" variant="accent" color="var(--nav-anchor)" />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginTop: "0.75rem" }}>
            <Badge label="Operated" variant="accent" color="var(--color-success)" suffix="0.7" size="md" />
            <Badge label="Worn" variant="accent" color="var(--brand-accent)" suffix="0.3" size="md" />
            <Badge label="Software" variant="accent" color="rgba(44, 34, 30, 0.55)" size="lg" />
          </div>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.18 Pro/Con Card</h2>
        <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <ProConCard
            type="pro"
            text="A positive point, expanded by default"
            defaultOpen
            quotes={[
              { text: "A supporting quote, long enough to wrap onto a second line inside the expanded panel.", source: "Source A" },
              { text: "A second supporting quote, attributed to a different source.", source: "Source B" },
            ]}
          />
          <ProConCard
            type="pro"
            text="A second positive point, collapsed"
            quotes={[
              { text: "A single supporting quote.", source: "Source C" },
            ]}
          />
          <ProConCard
            type="con"
            text="A negative point, expanded by default"
            defaultOpen
            quotes={[
              { text: "A supporting quote for the negative point.", source: "Source D" },
              { text: "A second quote, shown with the nested badge row below.", source: "Source E" },
            ]}
          >
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <Badge label="Expert" variant="expert" dot />
              <Badge label="Marketplace" variant="marketplace" dot />
            </div>
          </ProConCard>
          <ProConCard
            type="con"
            text="A negative point with no quotes attached"
          />
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.22 Modifier Types</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem", maxWidth: 480 }}>

          {/* Feature — boolean capabilities, toggle chips */}
          <div>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Feature</h3>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "var(--ui-text-faint)" }}>Boolean capability. Present or absent. Checkbox filters.</p>
            <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
              <Badge label="ANC" variant="default" size="sm" />
              <Badge label="Wireless" variant="default" size="sm" />
              <Badge label="Bluetooth" variant="default" size="sm" />
              <Badge label="Waterproof" variant="default" size="sm" />
              <Badge label="Touchscreen" variant="default" size="sm" />
            </div>
          </div>

          {/* Spec — quantitative, with units + dividers */}
          <div>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Spec</h3>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "var(--ui-text-faint)" }}>Quantitative measurement with units. Range filters, spec tables.</p>
            <Card>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {[
                  { name: "Battery", value: "30 hrs" },
                  { name: "Weight", value: "250g" },
                  { name: "Driver", value: "40mm" },
                  { name: "Impedance", value: "32\u03A9" },
                ].map((s, idx) => (
                  <div key={s.name}>
                    {idx > 0 && <div style={{ margin: "0.375rem 0" }}><Divider variant="recess" /></div>}
                    <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem", fontSize: "0.8125rem" }}>
                      <span style={{ color: "var(--ui-text-dim)", whiteSpace: "nowrap" }}>{s.name}</span>
                      <span style={{ flex: 1, borderBottom: "1px dotted var(--ui-text-dim)", opacity: 0.3, minWidth: "1.5rem", marginBottom: "0.2em" }} />
                      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--ui-text-primary)", whiteSpace: "nowrap" }}>{s.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Material / Content — what it contains */}
          <div>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Material / Content</h3>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "var(--ui-text-faint)" }}>What it is made of or contains. Ingredient lists, material callouts.</p>
            <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
              <Badge label="Ceramide" variant="accent" color="#5B8C6F" size="sm" dot />
              <Badge label="Hyaluronic Acid" variant="accent" color="#5B8C6F" size="sm" dot />
              <Badge label="Niacinamide" variant="accent" color="#5B8C6F" size="sm" dot />
              <Badge label="Carbon Plate" variant="accent" color="#5B8C6F" size="sm" dot />
            </div>
            <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
              <Badge label="Fragrance-Free" variant="accent" color="#8B6F5B" size="sm" />
              <Badge label="Alcohol-Free" variant="accent" color="#8B6F5B" size="sm" />
              <Badge label="Paraben-Free" variant="accent" color="#8B6F5B" size="sm" />
            </div>
            <div style={{ marginTop: "0.375rem", fontSize: "0.6875rem", color: "var(--ui-text-faint)" }}>
              Dot = contains. No dot = absence (what is NOT in it).
            </div>
          </div>

          {/* Form Factor — segmented bar, one segment filled */}
          <div>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Form Factor</h3>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "var(--ui-text-faint)" }}>Physical shape. Mutually exclusive. One segment filled, rest trough.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
              <FormFactorBar labels={["Over-ear", "On-ear", "In-ear", "Bone"]} selected={0} title="Headphone type" />
              <FormFactorBar labels={["Clamshell", "2-in-1", "Detachable"]} selected={1} title="Laptop style" />
            </div>
          </div>

          {/* Compliance — cert badge + authority in recess */}
          <div>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Compliance</h3>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "var(--ui-text-faint)" }}>Third-party certification. Badge + authority in a recessed label.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {[
                { cert: "Reef-safe", authority: "H.E.L." },
                { cert: "Non-Comedogenic", authority: "Derm. tested" },
                { cert: "Fair Trade", authority: "F.L.O." },
                { cert: "FSC Certified", authority: "F.S.C." },
                { cert: "NIOSH N95", authority: "N.I.O.S.H." },
              ].map((c) => (
                <div key={c.cert} style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  <Badge label={c.cert} variant="success" size="sm" dot />
                  <span style={{
                    position: "relative",
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0.1875rem 0.5rem",
                    lineHeight: "1",
                    borderRadius: "9999px",
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                    fontStyle: "oblique",
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.05em",
                    color: "var(--ui-text-faint)",
                    background: "linear-gradient(180deg, var(--ui-trough-grad-top), var(--ui-trough-grad-mid) 55%, var(--ui-trough-grad-bot))",
                    boxShadow: "inset 0 1px 2px var(--ui-trough-inset-top), inset 0 -1px 0 var(--ui-trough-floor-hi), 0 1px 2px rgba(0,0,0,0.05)",
                    backdropFilter: "blur(1px) saturate(1.3)",
                    WebkitBackdropFilter: "blur(1px) saturate(1.3)",
                  }}>{c.authority}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Lifestyle — ghost badge variant */}
          <div>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Lifestyle</h3>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.75rem", color: "var(--ui-text-faint)" }}>Brand positioning. Tracked but flagged as marketing, not truth. Not filterable.</p>
            <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
              <Badge label="Professional" variant="ghost" size="sm" />
              <Badge label="Gaming" variant="ghost" size="sm" />
              <Badge label="Rugged" variant="ghost" size="sm" />
              <Badge label="Budget" variant="ghost" size="sm" />
              <Badge label="Premium" variant="ghost" size="sm" />
              <Badge label="Studio" variant="ghost" size="sm" />
            </div>
          </div>

          {/* Combined — all types on one card */}
          <div>
            <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", fontWeight: 600, color: "var(--ui-text-dim)" }}>Combined on one card</h3>
            <Card>
              <div style={{ fontSize: "0.9375rem", fontWeight: 700 }}>Demo item name</div>

              <div style={{ margin: "0.625rem 0" }}><Divider variant="recess" /></div>

              <div style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--ui-text-faint)", marginBottom: "0.3rem" }}>Features</div>
              <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                <Badge label="ANC" variant="default" size="sm" />
                <Badge label="Wireless" variant="default" size="sm" />
                <Badge label="Bluetooth 5.3" variant="default" size="sm" />
                <Badge label="Multipoint" variant="default" size="sm" />
              </div>

              <div style={{ margin: "0.625rem 0" }}><Divider variant="recess" /></div>

              <div style={{ display: "flex", gap: "1.5rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--ui-text-faint)", marginBottom: "0.3rem" }}>Specs</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", fontSize: "0.75rem" }}>
                    {[{ n: "Battery", v: "30hrs" }, { n: "Weight", v: "250g" }, { n: "Driver", v: "40mm" }].map((s) => (
                      <div key={s.n} style={{ display: "flex", alignItems: "baseline", gap: "0.25rem" }}>
                        <span style={{ color: "var(--ui-text-faint)", whiteSpace: "nowrap" }}>{s.n}</span>
                        <span style={{ flex: 1, borderBottom: "1px dotted var(--ui-text-dim)", opacity: 0.3, minWidth: "1rem", marginBottom: "0.2em" }} />
                        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{s.v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Divider variant="recess" orientation="vertical" />

                <div>
                  <div style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--ui-text-faint)", marginBottom: "0.3rem" }}>Form factor</div>
                  <Badge label="Over-ear" variant="default" size="sm" />

                  <div style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--ui-text-faint)", marginBottom: "0.2rem", marginTop: "0.875rem" }}>Positioning</div>
                  <Badge label="Premium" variant="ghost" size="sm" />
                </div>
              </div>

              <div style={{ margin: "0.625rem 0" }}><Divider variant="recess" /></div>

              <div style={{ fontSize: "0.5625rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--ui-text-faint)", marginBottom: "0.3rem" }}>Compliance</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                <Badge label="Hi-Res Audio" variant="success" size="sm" dot />
                <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0.15rem 0.5rem 0.225rem",
                    borderRadius: "9999px",
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                    fontStyle: "oblique",
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.03em",
                    color: "var(--ui-text-faint)",
                    background: "linear-gradient(180deg, var(--ui-trough-grad-top), var(--ui-trough-grad-mid) 55%, var(--ui-trough-grad-bot))",
                    boxShadow: "inset 0 1px 2px var(--ui-trough-inset-top), inset 0 -1px 0 var(--ui-trough-floor-hi)",
                  }}>J.A.S.</span>
              </div>
            </Card>
          </div>
        </div>
      </section>
        </>
      )}

      {cat === "type" && (
        <>

      <section className="ui-playground-section">
        <h2>§3.19 Link Text</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 480 }}>
          <div style={{ fontSize: "0.875rem", lineHeight: 1.8 }}>
            <p>
              Inline links inside a paragraph of body text — {" "}
              <LinkText href="#">one</LinkText>,{" "}
              <LinkText href="#">two</LinkText>, and a{" "}
              <LinkText href="#">third</LinkText> — plus an{" "}
              <LinkText href="#" external>external link</LinkText> at the end.
            </p>
          </div>
          <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.75rem" }}>
            <LinkText href="#" dim={0.6}>dim 0.6</LinkText>
            <LinkText href="#" dim={0.4}>dim 0.4</LinkText>
            <LinkText href="#" dim={0.3}>dim 0.3</LinkText>
          </div>
        </div>
      </section>

      <section className="ui-playground-section">
        <h2>§3.23 Lift Text</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", alignItems: "flex-start" }}>
          <LiftText as="h3" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontStyle: "italic", fontSize: "2rem" }}>
            Two clicks to the verdict.
          </LiftText>
          <LiftText style={{ fontSize: "1rem", fontWeight: 500 }}>
            Inline lift on a normal paragraph.
          </LiftText>
        </div>
      </section>
        </>
      )}

      {cat === "currency" && (
        <>

      <section className="ui-playground-section">
        <h2>§3.24 Secredit (coin)</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "2.5rem", flexWrap: "wrap", padding: "1rem 0" }}>
          {[24, 48, 96, 160].map((s) => (
            <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
              <Secredit size={s} />
              <span style={{ fontSize: "0.75rem", color: "var(--ui-text-dim)" }}>{s}px</span>
            </div>
          ))}
        </div>
      </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo icons — local to the showcase, not part of the component library.
// ---------------------------------------------------------------------------

/** Form factor selector — trough containing distinct segments.
 *  Selected segment is frosted glass (raised), rest are recessed. Labels inside. */
function FormFactorBar({ labels, selected, title }: { labels: string[]; selected: number; title: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "var(--ui-text-faint)", marginBottom: "0.375rem" }}>{title}</div>
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          borderRadius: 12,
          background: "linear-gradient(180deg, var(--ui-trough-grad-top), var(--ui-trough-grad-mid) 55%, var(--ui-trough-grad-bot))",
          boxShadow: "inset 0 2px 4px var(--ui-trough-inset-top), inset 0 -1px 0 var(--ui-trough-floor-hi)",
        }}
      >
        {labels.map((l, i) => {
          const isSelected = i === selected;
          return (
            <div
              key={l}
              className={isSelected ? "ui-glass-pill" : undefined}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0.625rem 0.625rem",
                borderRadius: 9,
                fontSize: "0.8125rem",
                fontWeight: isSelected ? 700 : 500,
                letterSpacing: "0.01em",
                color: isSelected ? "var(--ui-text-primary)" : "var(--ui-text-faint)",
                textShadow: isSelected
                  ? "var(--ui-text-float-1), var(--ui-text-float-2), var(--ui-text-float-3)"
                  : "none",
              }}
            >
              {l}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StarIcon() {
  // Path shifted up 1 unit from the textbook "M12 2 ... L12 2z" layout.
  // A 5-point star with point-up has its centroid ~1 unit below its
  // bounding-box center (two bottom wings carry more mass than the
  // single top point), so BB-centering reads as sitting low.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 1l2.9 6.9L22 9l-5.5 4.7L18.2 21 12 17.2 5.8 21l1.7-7.3L2 9l7.1-1.1L12 1z" />
    </svg>
  );
}

function SparkleIcon() {
  // Path shifted down 2 units — the earlier version had M12 0 so the
  // shape's bounding box spanned y=0 to y=20 inside a 24-unit viewBox,
  // leaving 4 units of padding at the bottom and zero at the top. Now
  // the BB spans y=2 to y=22, centered.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2 2-8z" />
    </svg>
  );
}
