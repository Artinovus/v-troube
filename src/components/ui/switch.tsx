'use client';
import { Switch as S } from 'radix-ui';
import { cn } from '@/lib/utils';

export function Switch({ checked, onCheckedChange, id, className, ...rest }: { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string; className?: string; 'aria-label'?: string }) {
  return (
    <S.Root id={id} checked={checked} onCheckedChange={onCheckedChange} className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-sand-strong transition-colors data-[state=checked]:bg-brown', className)} {...rest}>
      <S.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </S.Root>
  );
}
