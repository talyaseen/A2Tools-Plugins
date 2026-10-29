# Cooldowns

Your skill cooldowns and buffs as icons you place anywhere over the game, in the spirit of NotMeter's Combat Assist.

- **Skills:** every skill of your class with a cooldown. Turn on the ones to show; with "Add skills as you use them" on, each one you use turns itself on. A dark sweep and the seconds left run over each icon while it cools down; it flashes when ready. Click a skill for its options: keep it showing when ready, a sound when ready, its name spoken when ready.
- **Buffs:** every buff you've had, and your class's own buffs from the start (those its skills put on you, `selfbuffs.js`). Show any as its own icon; a buff from one of your skills shows on that skill's icon too. Options: keep it showing (greyed, near black) while it isn't on you, a sound or its name spoken just before it ends. A buff's ranks and variants (one name, one icon) are one row.
- **Look:** one bar or skills and buffs apart, icon size, the way it grows, icons per line, opacity, a buff's time left (a green bar, a green ring, or a clockwise fade over the icon), seconds, the flash. Ready icons stay hidden unless "Keep showing when ready" is on. To place inactive icons, enable "Preview inactive icons while unlocked"; locking hides those previews again.
- **Alerts:** the sound, its volume (for the spoken names too), spoken names and the voice (any of your computer's voices, Default being the first in the meter's language; or the built-in English one, Kokoro, `kokoro.js` from `tools/voices/make_voice.py`, which speaks when the computer has none, as on Linux), its type (Any, Female, Male: told by the voice's name, `voices.js`, the same file as Event Timers'), its speed and Test voice, how long before a buff ends to warn. Names that come together are queued, two at most.
- **Setup:** keep selections and alert choices per character (the default), or share them with every character of the same class. Switching back restores that character's own choices. Measured cooldowns stay per character in either mode because their equipment can differ. Characters with the same name on different known servers have separate personal setups and measurements.

## Changes in 0.2.7

- Added optional class setups for selected skills, buffs and their alert choices. Each character's own setup is retained, including changes made before enabling sharing. Changing back to character mode restores those choices; measured cooldowns are never copied from another character.
- Kept the latest character and selected setup consistent when storage reads finish out of order. Returning to the displayed character cancels an unfinished switch, and a scope change cannot cancel the latest game character. A first skill cast during a class-setup read keeps its auto-added icon unless that setup explicitly hides it. New casts survive a pending class read after the identity changes.
- Temporarily disabled skill and buff choices while a character or saved setup is loading, including its initial save. The setup selector stays available to cancel or change scope. Late clicks from a previous character or setup are ignored, and an older request cannot unlock choices during a newer load.
- Separated same-name characters on different known servers. A switch loads the destination server's personal setup and clears the previous character's live timers. Temporary server-zero metadata keeps the known identity. A provisional server-zero setup can carry forward when its server becomes known, with a saved destination setup taking precedence. Optional class choices can still be shared across servers; cooldown measurements stay personal.
- Added a clockwise buff fade alongside the existing bar and ring. Buff refreshes use the server's complete interval, so an extended countdown and its visual progress agree. Stack changes that retain the interval keep their current progress.
- Showed the next recharge timer when another charge is still usable, alongside the usable charge count. Recharge and buff countdowns use separate positions when both are active. Server remaining-time corrections continue to determine the cooldown.
- Made inactive icons follow their visibility choice while the overlay is unlocked. Ready skills stay hidden unless "Keep showing when ready" is enabled. The new optional inactive preview makes layout placement available without enabling those icons during play; locking hides previews.

Run `node --test tests/*.test.mjs` and `python tools/build_catalog.py` to check profile boundaries, delayed-read races, buff intervals, charge timers and icon visibility. No decoder, permission or skill-table layout changed, and this release uses the existing meter character events. The specific intermittent Shield of Protection flicker has not been reproduced in a live session; the verified change covers its first-charge recharge display rather than claiming a separate flicker cause.

## Where the times come from

The game works cooldowns out itself, so nothing in its traffic says how long a skill's cooldown is when you use it. The plugin reads (all decoders in `manifest.json`):

| Opcode | What it is |
| --- | --- |
| `01 38` | You used a skill: its id (a variant of the skill; its cooldown group is the base, see `skills.js` `variants`). |
| `47 38` | Cooldowns: a list of (group, ms left). One entry when something changed a cooldown (0: it was reset); every group at once now and then. |
| `2A 38`, `2B 38`, `2C 38` | A buff on you added, changed, removed (`capture/abnormal.rs` in the meter has the layout). |

A skill starts at the game's base time (Skill table `NeedCoolTime`, shown with ≈). Whenever a full list arrives, the time since you used a skill plus the time it has left is its real cooldown, with your cooldown reduction in it (a Sorcerer's 60 s skills ran 27.8 s). The median of the last five is kept, per character. A measurement is dropped when the skill was reset meanwhile, or was used again without `01 38` (not every use sends it: the list then shows it ready, or with more left than it should have). Skills not yet measured scale by how far the measured ones are below base.

Skills with charges show the time until the next charge returns even while another charge remains usable. The charge count stays visible alongside that time. A changed buff uses the game's complete start/end interval, so a refresh restarts its ring when the server restarts the duration; stack changes that preserve the interval do not restart it artificially.

## Data

`skills.js` and `icons/` are built by `tools/cooldowns/build_skills.py` from the game's Skill and SkillAbnormal tables and the meter's skill and buff names:

```
python tools/cooldowns/build_skills.py --tables <extractor>/Output/AION2/Content/Data/Table
python tools/cooldowns/build_self_buffs.py --tables <extractor>/Output/AION2/Content/Data/Table
```

`selfbuffs.js` (the second, after `skills.js`) lists the buffs each class's skills put on yourself: a class skill's effects (Skill `SkillEffectTimeDataList`) aimed at yourself or at friends (SkillEffectFilter `Self`, or friendly), whose SkillEffect rows apply an abnormal (`Abnormal`, `Abnormal_True`: the third value), kept to the buffs `skills.js` has; a passive's own skills count too.

## Not yet

Party members' cooldowns, debuffs on your target, the boss's casts and presets you can share: the decoders only read your own character for now.
