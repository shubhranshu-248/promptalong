import { initials, presenceVars, type PresenceSlot } from '../presence';

export interface Person {
  id: string;
  name: string;
  slot: PresenceSlot;
}

export function Avatar({ person }: { person: Person }) {
  const v = presenceVars(person.slot);
  return (
    <span
      className="inline-grid size-8 flex-none place-items-center rounded-full border-2 border-surface text-xs font-bold leading-none"
      style={{ background: v.color, color: v.label }}
      title={person.name}
    >
      <span aria-hidden="true">{initials(person.name)}</span>
      <span className="sr-only">{person.name}</span>
    </span>
  );
}

export function AvatarStack({ people }: { people: readonly Person[] }) {
  return (
    <span className="flex [&>*+*]:-ml-1.5">
      {people.map((p) => (
        <Avatar key={p.id} person={p} />
      ))}
    </span>
  );
}
