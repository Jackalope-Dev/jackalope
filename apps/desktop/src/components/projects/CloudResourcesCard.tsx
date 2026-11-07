import { Button, SettingGroup } from '@jackalope/ui';
import { resourceOption } from '../../lib/cloud-resources-plan';
import { cloudResourcesStatus } from '../../lib/cloudflare-resources';
import { isTauriEnvironment } from '../../lib/native/env';
import { useNativeResource } from '../../lib/useNativeResource';
import { openCloudResources, openSettings } from '../layout/navigation';

/** Project settings entry to the Cloud resources screen, or to connecting Cloudflare first. */
export function CloudResourcesCard({
  projectId,
  projectPath,
}: {
  projectId: string;
  projectPath: string;
}) {
  const { data: status } = useNativeResource(
    () => cloudResourcesStatus(projectPath),
    [projectPath],
    { enabled: isTauriEnvironment() },
  );
  if (!status) return null;
  const resources = status.manifest?.resources ?? [];
  if (!status.accountId && resources.length === 0) {
    return (
      <SettingGroup
        title="Cloud resources"
        description="Connect Cloudflare to create storage, databases and queues for this project."
        action={
          <Button variant="outline" onClick={() => openSettings('Cloudflare')}>
            Connect Cloudflare
          </Button>
        }
      />
    );
  }
  return (
    <SettingGroup
      className="cloud-resources-card"
      title="Cloud resources"
      description={
        resources.length
          ? `${resources.map((resource) => resourceOption(resource.kind).title).join(', ')} in Cloudflare, recorded in .jackalope/cloudflare.json.`
          : 'Create R2 storage, a D1 database, KV, Queues and more for this project in your Cloudflare account.'
      }
      action={
        <Button
          variant={resources.length ? 'outline' : undefined}
          onClick={() => openCloudResources(projectId)}
        >
          {resources.length ? 'Manage resources' : 'Set up resources'}
        </Button>
      }
    />
  );
}
