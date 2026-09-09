import { Search } from 'lucide-react';
import { useState } from 'react';
import {
  filterScheduleTemplates,
  type ScheduleTemplate,
  scheduleTemplates,
} from '../../lib/schedule-templates';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
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
      <div className="template-library-heading">
        <div>
          <h2 id="template-library-title" className="text-xl font-medium">
            Start with a useful routine
          </h2>
          <p className="task-muted mt-2">
            Choose a template, tailor it to your project, and enable when ready.
          </p>
        </div>
        <span className="task-muted">{scheduleTemplates.length} templates</span>
      </div>
      <div className="template-library-filters">
        <label className="template-search" htmlFor="schedule-template-search">
          <Search size={18} aria-hidden="true" />
          <Input
            id="schedule-template-search"
            aria-label="Search recurring templates"
            placeholder="Search templates"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Select aria-label="Template category" value={category} onValueChange={setCategory}>
          {['All', 'Security', 'Product quality', 'Engineering', 'Project health'].map((value) => (
            <SelectItem key={value} value={value}>
              {value === 'All' ? 'All categories' : value}
            </SelectItem>
          ))}
        </Select>
      </div>
      {showAll && (
        <p className="task-muted" role="status">
          {filtered.length} matching templates
        </p>
      )}
      <div className="template-library-list">
        {visible.map((template) => (
          <article className="template-library-row" key={template.id}>
            <div>
              <p className="task-muted text-xs">
                {template.category} · {template.mode} · {template.cadence}
              </p>
              <h3 className="text-base font-medium mt-1">{template.name}</h3>
              <p className="mt-2">{template.summary}</p>
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
        <Button variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer templates' : `Browse all ${scheduleTemplates.length} templates`}
        </Button>
      )}
    </section>
  );
}
