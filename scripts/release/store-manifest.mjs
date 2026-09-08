import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const xml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export function storeManifest({ name, publisher, publisherDisplayName, version }) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$/.test(name))
    throw new Error('Provide the Package/Identity/Name from Partner Center.');
  if (
    typeof publisher !== 'string' ||
    !publisher.startsWith('CN=') ||
    publisher.length > 8192 ||
    Array.from(publisher).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('Provide the Package/Identity/Publisher from Partner Center.');
  if (
    typeof publisherDisplayName !== 'string' ||
    !publisherDisplayName.trim() ||
    publisherDisplayName.length > 256 ||
    Array.from(publisherDisplayName).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('Provide the publisher display name.');
  const parts =
    typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
      ? version.split('.').map(Number)
      : [];
  if (parts.length !== 3 || parts.some((part) => part > 65535) || parts.every((part) => part === 0))
    throw new Error(
      'Store versions require three numeric components in 0..65535, with a nonzero version.',
    );
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap uap10 rescap">
 <Identity Name="${xml(name)}" Publisher="${xml(publisher)}" Version="${version}.0" ProcessorArchitecture="x64" />
 <Properties><DisplayName>Jackalope</DisplayName><PublisherDisplayName>${xml(publisherDisplayName)}</PublisherDisplayName><Description>A workspace for your projects and coding agents.</Description><Logo>Assets/StoreLogo.png</Logo></Properties>
 <Resources><Resource Language="en-US" /></Resources>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.22621.0" /></Dependencies>
 <Applications><Application Id="Jackalope" Executable="jackalope-desktop.exe" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
  <uap:VisualElements DisplayName="Jackalope" Description="A workspace for your projects and coding agents." Square150x150Logo="Assets/Square150x150Logo.png" Square44x44Logo="Assets/Square44x44Logo.png" BackgroundColor="transparent" />
 </Application></Applications>
 <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [destination, name, publisher, publisherDisplayName, version] = process.argv.slice(2);
  const manifest = storeManifest({ name, publisher, publisherDisplayName, version });
  writeFileSync(destination, manifest);
}
