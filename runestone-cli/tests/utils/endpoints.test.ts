import { mailpitUiUrl, smtpEndpoints, traefikDashboardUrl } from '../../src/utils/endpoints';
import { testEnv } from '../helpers/env';

describe('endpoints of what Runestone already runs', () => {
  it('derives every address from .env values', () => {
    const config = testEnv('/tmp/runestone-endpoints', { HOST_DOMAIN: 'example.test', PREFIX: 'mylab', SMTP_PORT: '2525' });

    expect(traefikDashboardUrl(config.HOST_DOMAIN)).toBe('https://traefik.example.test');
    expect(mailpitUiUrl(config.HOST_DOMAIN)).toBe('https://mailpit.example.test');
    expect(smtpEndpoints(config)).toEqual({
      fromHost: 'localhost:2525',
      // Inside the network the container port is used, not the published one:
      // Compose publishes ${SMTP_PORT}:1025, so 2525 exists only on the host.
      fromRunestoneNetwork: 'mylab:1025',
      fromOtherContainers: 'host.docker.internal:2525'
    });
  });
});
