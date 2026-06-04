import type { Avatar } from '../types';

interface Props {
  avatar: Avatar;
  size?: number;
  title?: string;
}

export function AvatarChip({ avatar, size = 26, title }: Props) {
  const style = {
    width: size,
    height: size,
    fontSize: size * 0.42,
    '--chip-color': avatar.color,
  } as React.CSSProperties;
  if (avatar.kind === 'image' && avatar.imageDataUrl) {
    return (
      <span className="chip" style={style} title={title}>
        <img src={avatar.imageDataUrl} alt={title ?? ''} />
      </span>
    );
  }
  if (avatar.kind === 'emoji') {
    return (
      <span className="chip chip--emoji" style={{ ...style, fontSize: size * 0.55 }} title={title}>
        {avatar.emoji}
      </span>
    );
  }
  return (
    <span className="chip" style={style} title={title}>
      {avatar.initials}
    </span>
  );
}
