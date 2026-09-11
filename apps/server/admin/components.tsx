import {
  Button,
  EmptyState,
  ExternalLinkIcon,
  FormField,
  InlineNotice,
  PageHeader,
  RefreshIcon,
  Select,
  SelectItem,
  Table as UiTable,
} from '@jackalope/ui';

import type { ReactNode } from 'react';

const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  disabled?: boolean;
}) {
  return (
    <FormField label={label}>
      <Select
        value={value || '__all__'}
        onValueChange={(next) => onChange(next === '__all__' ? '' : next)}
        disabled={disabled}
        nonce={nonce}
      >
        {options.map(([value, label]) => (
          <SelectItem key={value} value={value || '__all__'}>
            {label}
          </SelectItem>
        ))}
      </Select>
    </FormField>
  );
}
export function Heading({
  title,
  eyebrow,
  children,
  action,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <PageHeader
      title={title}
      eyebrow={eyebrow}
      description={children}
      action={action}
      className="page-heading"
    />
  );
}
export function Refresh({
  loading,
  onClick,
  children = 'Refresh',
}: {
  loading: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <Button variant="secondary" loading={loading} loadingLabel="Refreshing…" onClick={onClick}>
      <RefreshIcon size={16} style={{ flexShrink: 0 }} aria-hidden="true" />
      {children}
    </Button>
  );
}
export function ErrorNotice({ children }: { children: string }) {
  return children ? <InlineNotice tone="error">{children}</InlineNotice> : null;
}
export function QuickLink({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a className="quick-link" href={href}>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <ExternalLinkIcon size={20} aria-hidden="true" />
    </a>
  );
}
export function Table({
  headers,
  rows,
  label,
}: {
  headers: string[];
  rows: (string | number)[][];
  label: string;
}) {
  return rows.length ? (
    <UiTable label={label} className="table">
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.join('|')}>
            {row.map((value, index) => (
              <td key={headers[index]}>
                {typeof value === 'number' ? value.toLocaleString() : value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </UiTable>
  ) : (
    <EmptyState title="No events in this selection." />
  );
}
