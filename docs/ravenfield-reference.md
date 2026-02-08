# Ravenfield Beta 5 - Game Design Reference Sheet

Extracted numerical balance data for tuning Clawfield.

---

## Player Health & Damage

| Parameter | Value |
|-----------|-------|
| Max HP | 100 |
| Medipack restoration | 30 HP |
| Balance meter (stagger) | Max 100 points |
| Balance recovery rate | 10 points/second |
| Knockdown trigger | Balance < 0 |
| Hurt animation duration | 0.6 seconds |
| Piercing range | 2 units |

---

## Weapon Balance - Base Parameters

| Parameter | Value |
|-----------|-------|
| Default ammo (magazine) | 10 rounds |
| Default spare ammo | 50 rounds |
| Resupply amount | 10 rounds |
| Fire rate (cooldown) | 0.2 seconds (5 RPS) |
| Projectile speed | 100 units/second |
| Reload time | 2 seconds |
| Unholster time | 1.2 seconds |
| Aim FOV | 50 |
| Default FOV | 60 |

**Recoil:**

| Parameter | Value |
|-----------|-------|
| Kickback force | 2.0 |
| Random kick variance | 0.2 |
| Snap magnitude | 0.3 |
| Snap duration | 0.4 seconds |
| Snap frequency | 4 Hz |
| Effective range | 100 units |

---

## Specialized Weapons

**Scoped/Sniper:** Scope blackout 0.3s, scope FOV 30, zoom FOV 45

**Shell-Loaded (Shotguns):** AI reload time per shell: 0.4s

**Projectile Weapons (Rockets, Grenades):**

| Parameter | Value |
|-----------|-------|
| Base damage | 70 HP |
| Balance damage | 60 points |
| Impact force | 200 |
| Lifespan | 2 seconds |
| Damage falloff end | 300 units |
| Flyby detection radius | 15 units |

**Explosives:**

| Parameter | Value |
|-----------|-------|
| Explosion damage | 300 HP |
| Explosion balance damage | 300 points |
| Blast radius (damage) | 6 units |
| Blast radius (balance) | 9 units |
| Blast force | 500 units |
| Smoke duration | 8 seconds |

---

## Movement Parameters

**FPS Controller:**

| Parameter | Value |
|-----------|-------|
| Crouch height | 0.5 units |
| Stand height | 1.8 units |
| Camera FOV (default) | 60 |
| Fine aim FOV | 30 |
| Zoom FOV | 45 |
| Sensitivity (base) | 4.0 |
| Camera return speed | 400 units/second |
| Max use distance | 3 units |
| Death to loadout time | 2 seconds |

**AI Movement:**

| Parameter | Value |
|-----------|-------|
| Normal walk speed | 3.2 units/second |
| Sprint speed | 5.5 units/second |
| Target-engaged speed | 2.0 units/second |
| Avoidance min distance | 1.5 units |
| AI tick period | 0.2 seconds |
| Aim slerp speed | 6.0 |

---

## AI Behavior

**Accuracy by Difficulty:**

| Difficulty | Base Sway | Max Sway | Fire Rectangle |
|-----------|-----------|---------|-----------------|
| Easy | 0.01 | 0.1 | 2.5 units |
| Normal | 0.002 | 0.05 | 1.0 units |

**Cover:** Max search distance 50 units, angle threshold cos(30) = 0.866

---

## Ammunition & Supply

| Parameter | Value |
|-----------|-------|
| Resupply interval | 3 seconds |
| Detection radius | 6 units |
| Health restoration | 30 HP |

---

## Vehicle Balance

| Parameter | Value |
|-----------|-------|
| Max health | 1000 HP |
| Auto-damage (empty) | 7% max HP per 2s |
| Auto-damage start delay | 50 seconds |
| Explosion delay | 0.3 seconds |
| Drain claim time | 10 seconds |
| Min ram speed | 3 units/second |

---

## Game Mode

| Parameter | Value |
|-----------|-------|
| Victory point threshold | 200 points |
| Default respawn cycle | 5 seconds |
| Inter-spawn delay | 2 seconds |
| Normal spawn batch | 3 actors |
| Enhanced spawn batch | 5 actors |
| Super spawn frequency | Every 5 cycles |

---

## Design Patterns

1. **Separate health + balance damage** — enables stagger mechanics distinct from HP
2. **Tiered AI accuracy** — difficulty via sway multipliers, not damage changes
3. **Cover-based tactics** — 50-unit search radius, 30 degree angle coverage
4. **Supply management** — 3s resupply at 6-unit radius encourages grouping
5. **Vehicle attrition** — auto-damage after 50s empty prevents camping
6. **Sprint economy** — AI recovery periods create movement rhythm
7. **Projectile falloff** — 300-unit curve allows long-range weakened shots
