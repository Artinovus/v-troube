'use client';
import { useActionState } from 'react';
import { signInAction } from './actions';
import { Button } from '@/components/ui/button';
import { Card, Field, Input } from '@/components/ui/basic';

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, undefined);
  return (
    <Card className="p-5">
      <form action={action} className="space-y-4">
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Heslo" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        {state?.error ? <p role="alert" className="text-sm text-bad">{state.error}</p> : null}
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? 'Přihlašuji…' : 'Přihlásit se'}
        </Button>
      </form>
    </Card>
  );
}
