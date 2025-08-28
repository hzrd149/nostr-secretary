import { defined, simpleTimeout } from "applesauce-core";
import { firstValueFrom, type Observable } from "rxjs";

export function getValue<T>(
  observable: Observable<T>,
  timeout = 5_000,
): Promise<NonNullable<T>> {
  return firstValueFrom(observable.pipe(defined(), simpleTimeout(timeout)));
}
