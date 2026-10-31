import { SearchField } from '@jackalope/ui';

import { useState } from 'react';
import {
  filterScheduleTemplates,
  type ScheduleTemplate,
  scheduleTemplates,
} from '../../lib/schedule-templates';
import { Button } from '../ui/button';

import { Select, SelectItem } from '../ui/Select';
import './schedule-templates.css';

export function ScheduleTemplateLibrary({
  onChoose,
  disabled,
}: {
  onChoose: (template: ScheduleTemplate) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [expanded, setExpanded] = useState(false);
  const filtered = filterScheduleTemplates(query, category);
  const showAll = expanded || !!query.trim() || category !== 'All';
  const visible = showAll ? filtered : filtered.slice(0, 3);
  return (
    <section className="schedule-templates" aria-labelledby="template-library-title">
      <h2 id="template-library-title" className="text-xl font-medium">
        Start from a template
      </h2>
      <div className="template-library-filters">
        <SearchField
          id="schedule-template-search"
          aria-label="Search recurring templates"
          placeholder="Search templates"
          value={query}
          onValueChange={(value) => setQuery(value)}
          containerClassName="template-search"
        />
        <Select aria-label="Template category" value={category} onValueChange={setCategory}>
          {['All', 'Security', 'Product quality', 'Engineering', 'Project health'].map((value) => (
            <SelectItem key={value} value={value}>
              {value === 'All' ? 'All categories' : value}
            </SelectItem>
          ))}
        </Select>
      </div>
      {showAll && (
        <p className="sr-only" role="status">
          {filtered.length} matching templates
        </p>
      )}
      <div className="template-library-list">
        {visible.map((template) => (
          <article className="template-library-row" key={template.id}>
            <div>
              <h3 className="text-base font-medium">{template.name}</h3>
              <p className="task-muted mt-1">{template.summary}</p>
            </div>
            <Button
              variant="outline"
              disabled={disabled}
              aria-label={`Use template: ${template.name}`}
              onClick={() => onChoose(template)}
            >
              Use template
            </Button>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="py-4">
          <p>No templates match. Try another topic or clear the filters.</p>
          <Button
            variant="ghost"
            onClick={() => {
              setQuery('');
              setCategory('All');
            }}
          >
            Clear filters
          </Button>
        </div>
      )}
      {!query.trim() && category === 'All' && (
        <Button
          variant="outline"
          className="self-start"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show fewer templates' : `Browse all ${scheduleTemplates.length} templates`}
        </Button>
      )}
    </section>
  );
}
