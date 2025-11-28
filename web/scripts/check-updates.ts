#!/usr/bin/env tsx
/* eslint-disable no-console */
import { execFileSync } from 'node:child_process';

/**
 * Check for outdated npm packages and warn about them.
 * Runs during build but never fails - just warns.
 *
 * Categorizes updates:
 * - Minor/patch: Safe to run `npm update`
 * - Major: Requires manual review (breaking changes possible)
 */

interface OutdatedPackage {
  current: string;
  wanted: string;
  latest: string;
}

type PackageEntry = [string, OutdatedPackage];

interface CategorizedUpdates {
  major: PackageEntry[];
  minor: PackageEntry[];
}

// -----------------------------------------------------------------------------
// Pure Functions
// -----------------------------------------------------------------------------

function getMajorVersion(version: string): string {
  return version.split('.')[0] ?? '0';
}

function isMajorUpdate(current: string, latest: string): boolean {
  return getMajorVersion(current) !== getMajorVersion(latest);
}

function categorizeUpdates(packages: PackageEntry[]): CategorizedUpdates {
  const major: PackageEntry[] = [];
  const minor: PackageEntry[] = [];

  for (const entry of packages) {
    const [, info] = entry;
    if (isMajorUpdate(info.current, info.latest)) {
      major.push(entry);
    } else if (info.current !== info.wanted) {
      minor.push(entry);
    }
  }

  return { major, minor };
}

// -----------------------------------------------------------------------------
// I/O Functions
// -----------------------------------------------------------------------------

function fetchOutdatedPackages(): PackageEntry[] | null {
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    let output = '';

    try {
      output = execFileSync(npmCmd, ['outdated', '--json'], {
        encoding: 'utf-8',
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      // npm outdated exits with code 1 when packages are outdated - output is still in stdout
      output = (e as { stdout?: string }).stdout ?? '';
    }

    const trimmed = output.trim();
    if (!trimmed || trimmed === '{}') {
      return [];
    }

    return Object.entries(JSON.parse(trimmed) as Record<string, OutdatedPackage>);
  } catch {
    console.log('⚠️  Could not check for updates (this is not a build failure)\n');
    return null;
  }
}

function printUpdateSummary({ major, minor }: CategorizedUpdates): void {
  if (minor.length > 0) {
    console.log('⚠️  Safe updates available (run `npm update`):');
    minor.forEach(([name, info]) => console.log(`   ${name}: ${info.current} → ${info.wanted}`));
    console.log('');
  }

  if (major.length > 0) {
    console.log('🔶 Major version updates available (requires manual review):');
    major.forEach(([name, info]) => console.log(`   ${name}: ${info.current} → ${info.latest}`));
    console.log('');
  }

  if (major.length > 0 || minor.length > 0) {
    console.log('💡 Run `npm outdated` for full details.\n');
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

function main(): void {
  console.log('\n📦 Checking for package updates...\n');

  const packages = fetchOutdatedPackages();
  if (packages === null) return; // Error already logged

  if (packages.length === 0) {
    console.log('✅ All packages are up to date!\n');
    return;
  }

  const updates = categorizeUpdates(packages);
  printUpdateSummary(updates);
}

main();
