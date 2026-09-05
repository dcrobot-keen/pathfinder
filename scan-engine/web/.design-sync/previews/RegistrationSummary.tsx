import { RegistrationSummary } from 's2m-ui';

export function Default() {
  return (
    <RegistrationSummary
      rows={[
        ['회전', '42.3°'],
        ['이동', '1.84, 3.02 m'],
        ['RMSE', '3.1 cm'],
      ]}
    />
  );
}

export function LargeOffset() {
  return (
    <RegistrationSummary
      rows={[
        ['회전', '-4.2°'],
        ['이동', '0.61, -0.15 m'],
        ['RMSE', '18.2 cm'],
      ]}
    />
  );
}
