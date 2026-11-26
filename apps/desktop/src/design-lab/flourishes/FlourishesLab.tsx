import type { ReactNode } from 'react';
import { BorderBeamLab } from './BorderBeamLab';
import { BotAvatarLab } from './BotAvatarLab';
import { DistortionWaveLab } from './DistortionWaveLab';
import { LiquidLab } from './LiquidLab';
import { ThinkingOrbLab } from './ThinkingOrbLab';

function LabSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-[var(--color-bg)] p-8 mt-8">
      <h2 className="text-base font-medium mb-6">{title}</h2>
      {children}
    </section>
  );
}

export function FlourishesLab() {
  return (
    <>
      <LabSection title="Border beam">
        <BorderBeamLab />
      </LabSection>
      <LabSection title="Thinking orbs">
        <ThinkingOrbLab />
      </LabSection>
      <LabSection title="Distortion wave">
        <DistortionWaveLab />
      </LabSection>
      <LabSection title="Liquid">
        <LiquidLab />
      </LabSection>
      <LabSection title="Bot avatars">
        <BotAvatarLab />
      </LabSection>
    </>
  );
}
