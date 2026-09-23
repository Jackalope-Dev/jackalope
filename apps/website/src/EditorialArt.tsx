import { EchoMark } from '@jackalope/brand/echo';
import {
  BookOpen,
  Check,
  Code2,
  FileCode2,
  Folder,
  GitBranch,
  GitMerge,
  MousePointer2,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import type { EditorialCover } from './blog-types';
import './editorial-art.css';

export function EditorialArt({ kind, tone, label }: EditorialCover) {
  return (
    <div className={`editorial-art editorial-${kind} art-tone-${tone}`} aria-hidden="true">
      <span className="art-caption">{label}</span>
      <div className="art-drawing">
        {kind === 'map' && (
          <div className="art-map">
            <svg viewBox="0 0 360 180" fill="none" aria-hidden="true">
              <path d="M180 90 60 40M180 90 300 35M180 90 310 140M180 90 70 145" />
              <path d="M60 40 70 145M300 35 310 140" strokeDasharray="4 6" />
            </svg>
            <span className="map-center">
              <Folder size={27} />
            </span>
            <span className="map-leaf map-leaf-one">
              <FileCode2 size={20} />
            </span>
            <span className="map-leaf map-leaf-two">
              <Code2 size={20} />
            </span>
            <span className="map-leaf map-leaf-three">
              <FileCode2 size={20} />
            </span>
            <span className="map-leaf map-leaf-four">
              <Code2 size={20} />
            </span>
          </div>
        )}
        {kind === 'parallel' && (
          <div className="art-branches">
            <svg viewBox="0 0 360 180" fill="none" aria-hidden="true">
              <path d="M35 90H75C100 90 85 40 115 40H245C275 40 260 90 290 90H325M75 90C100 90 85 140 115 140H245C275 140 260 90 290 90" />
              <path d="M75 90H290" strokeDasharray="4 6" />
            </svg>
            <span className="branch-lane">
              <GitBranch size={18} /> One task
            </span>
            <span className="branch-lane">
              <GitBranch size={18} /> Another idea
            </span>
            <span className="branch-merge">
              <GitMerge size={22} />
            </span>
          </div>
        )}
        {(kind === 'context' || kind === 'quality') && (
          <div className="art-documents">
            <div className="art-paper art-paper-back">
              <BookOpen size={22} />
              <i />
              <i />
            </div>
            <div className="art-paper">
              {kind === 'quality' ? <SlidersHorizontal size={24} /> : <BookOpen size={24} />}
              <strong>{kind === 'quality' ? 'Keep it focused.' : 'Project knowledge'}</strong>
              <i />
              <i />
              <i />
              <span className="art-paper-tag">
                {kind === 'quality'
                  ? 'Brief → check → review'
                  : 'A little context goes a long way.'}
              </span>
            </div>
          </div>
        )}
        {(kind === 'review' || kind === 'performance') && (
          <div className="art-review">
            <div className="art-window-bar">
              <span />
              <span />
              <span />
              <Code2 size={16} />
            </div>
            <div className="art-review-body">
              <div className="art-code-lines">
                <i />
                <i />
                <i />
                <i />
              </div>
              <span className="art-review-stamp">
                <Check size={17} />{' '}
                {kind === 'performance' ? 'Room for the details' : 'Ready for your review'}
              </span>
            </div>
            <span className="art-floating-icon">
              <ShieldCheck size={29} />
            </span>
          </div>
        )}
        {(kind === 'accounts' || kind === 'agents') && (
          <div className="art-accounts">
            <div>
              {kind === 'agents' ? <Code2 size={28} /> : <UserRound size={28} />}
              <strong>{kind === 'agents' ? 'Claude Code' : 'Work'}</strong>
              <span>{kind === 'agents' ? 'One perspective' : 'Project account'}</span>
            </div>
            <div>
              {kind === 'agents' ? <Code2 size={28} /> : <UserRound size={28} />}
              <strong>{kind === 'agents' ? 'Codex' : 'Personal'}</strong>
              <span>{kind === 'agents' ? 'Another approach' : 'Your own space'}</span>
            </div>
          </div>
        )}
        {kind === 'browser' && (
          <div className="art-browser">
            <div className="art-address">
              <Search size={13} />
              <span>Explore. Inspect. Review.</span>
            </div>
            <div className="art-browser-content">
              <div />
              <div />
              <div />
            </div>
            <span className="art-browser-cursor">
              <MousePointer2 size={34} />
            </span>
          </div>
        )}
        {kind === 'schedule' && (
          <div className="art-calendar">
            <strong>A little less on your list.</strong>
            <div>
              {Array.from({ length: 14 }, (_, index) => index + 1).map((day) => (
                <span key={day}>{[3, 6, 10].includes(day) ? <Check size={16} /> : day}</span>
              ))}
            </div>
          </div>
        )}
        {kind === 'studio' && <EchoMark className="art-echo" animated={false} />}
      </div>
    </div>
  );
}
