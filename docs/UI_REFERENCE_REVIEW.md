# Nexora UI reference review

Reviewed the local `Downloads/nexora-crm` template on 14 October 2026. It uses a TanStack monorepo with Base UI shadcn components, Geist, Tailwind and Recharts. Pay & Go retains its existing Vite application and Base UI preset.

## Adapted in this pass

| Reference pattern | Pay & Go adaptation |
| --- | --- |
| Inset sidebar layout | Framed desktop content surface, quieter sidebar, raised active navigation; existing role filtering and mobile navigation retained. |
| Neutral login with dotted backdrop | Theme-token background, compact form column and restrained typography; existing password, recovery and MFA flows retained. |
| Dashboard metric hierarchy | Larger tabular values and separated explanatory footers using existing shadcn cards. |
| Grouped Recharts reports | Official base-nova shadcn chart wrapper, date/KES axes, sales/refund series, exact-money tooltips and accessible report data list. |
| Six-digit two-factor verification | Official shadcn Input OTP with separate digit slots, numeric validation, paste handling, incomplete-submit guard and existing recovery-code fallback. |
| Settings sidebar and profile summary | Responsive account settings with Profile, Security and Appearance sections; server-provided profile details and real theme-provider controls. |
| Security settings sections | Focused cards for MFA status/enrollment, automatic locking, password changes and replacement recovery codes; confirmed server responses still control success. |
| Focused recovery/verification screens | Centred icons and headings, dedicated success panels and task-specific auth hero copy. |
| Report navigation and event history | Official Base UI shadcn tabs for reports and clearer audit cards with outcome badges and loading/error/empty surfaces. |

The template login explicitly reports that authentication is disconnected. Its social buttons, public registration, placeholder links, sample users, sales figures and trend badges do not represent Pay & Go requirements. No reference source code, remote logos, photographs or demo data were copied.

Recharts 3.10.1 is pinned in the frontend manifest/lockfile. It is MIT-licensed, actively maintained and runs in the client bundle without a separate hosting service. The official component was generated with the installed shadcn CLI; existing customized cards were preserved. References: [Base UI chart documentation](https://ui.shadcn.com/docs/components/base/chart), [Recharts source and licence](https://github.com/recharts/recharts).

The follow-up adds pinned MIT-licensed `input-otp` 1.5.0 through the official shadcn registry. It runs locally in the browser, adds no service, and preserves keyboard/autofill/paste behavior through the supported primitive. Tabs use the already-installed Base UI dependency. Profile edits remain manager-controlled; the reference's sample device sessions, local-only profile saves and unsupported notification/billing/integration controls were excluded.

## Next visual review

The connected browser confirmed the new Profile section against the existing local test manager session. The connection then failed before screenshots or further interaction. Check desktop expanded/collapsed navigation and phone layouts, auth loading/error/login/recovery/MFA states, and light/dark themes. Verify chart date labels and exact KES tooltips for a single day, zero activity and long periods. These visual checks remain pending.

Potential follow-up: use the official shadcn sidebar/sheet composition for a grouped phone navigation drawer, and lazy-load report modules to reduce the initial bundle. These remain proposals; the current mobile navigation is functional and no speculative trend data is added.
