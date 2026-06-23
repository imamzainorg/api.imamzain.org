import { Type } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from './api-response.dto';

/**
 * The success envelope ({ success, timestamp, message, data }) that
 * ResponseInterceptor wraps every successful response in. These factories
 * replace ~105 hand-written wrapper classes + ~25 list-data classes that
 * differed only by their `data` type and `message` example.
 *
 * Each call returns a FRESH base class so the per-envelope `data` schema stays
 * isolated. Extend it into a NAMED class so the generated OpenAPI component
 * name (and exported TS name) is preserved exactly:
 *
 *   export class FooDetailResponseDto extends ApiEnvelope(FooDto, 'Foo fetched') {}
 *   export class FooMessageResponseDto extends ApiEnvelope(null, 'Foo deleted') {}
 *   export class FooListResponseDto extends ApiEnvelope(FooListDataDto, 'Foos fetched') {}
 */
export function ApiEnvelope(
  dataType: Type<unknown> | [Type<unknown>] | null,
  messageExample: string,
  opts: { nullable?: boolean } = {},
) {
  class Envelope {
    @ApiProperty({ example: true })
    success: boolean;

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    timestamp: string;

    @ApiProperty({ example: messageExample })
    message: string;
  }

  if (dataType === null) {
    ApiProperty({ type: Object, nullable: true, example: null })(Envelope.prototype, 'data');
  } else {
    ApiProperty({ type: dataType, ...(opts.nullable ? { nullable: true } : {}) })(Envelope.prototype, 'data');
  }

  return Envelope;
}

/**
 * The paginated list-data shape ({ items: T[], pagination }). Extend into a
 * named class to keep the OpenAPI component name:
 *
 *   export class FooListDataDto extends ApiPaginatedData(FooDto) {}
 */
export function ApiPaginatedData(itemType: Type<unknown>) {
  class PaginatedData {
    @ApiProperty({ type: [itemType] })
    items: unknown[];

    @ApiProperty({ type: PaginationMetaDto })
    pagination: PaginationMetaDto;
  }

  return PaginatedData;
}
