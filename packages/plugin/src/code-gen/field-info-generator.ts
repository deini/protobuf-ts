import * as rt from "@protobuf-ts/runtime";
import * as ts from "typescript";
import {DescriptorRegistry, TypescriptImportManager, typescriptLiteralFromValue} from "@protobuf-ts/plugin-framework";


const repeatTypeMapping = {
    [rt.RepeatType.NO]: "NO",
    [rt.RepeatType.PACKED]: "PACKED",
    [rt.RepeatType.UNPACKED]: "UNPACKED",
} as const;


const longTypeMapping = {
    [rt.LongType.STRING]: "STRING",
    [rt.LongType.BIGINT]: "BIGINT",
    [rt.LongType.NUMBER]: "NUMBER",
} as const;


const scalarTypeMapping = {
    [rt.ScalarType.DOUBLE]: "DOUBLE",
    [rt.ScalarType.FLOAT]: "FLOAT",
    [rt.ScalarType.INT64]: "INT64",
    [rt.ScalarType.UINT64]: "UINT64",
    [rt.ScalarType.INT32]: "INT32",
    [rt.ScalarType.FIXED64]: "FIXED64",
    [rt.ScalarType.FIXED32]: "FIXED32",
    [rt.ScalarType.BOOL]: "BOOL",
    [rt.ScalarType.STRING]: "STRING",
    [rt.ScalarType.BYTES]: "BYTES",
    [rt.ScalarType.UINT32]: "UINT32",
    [rt.ScalarType.SFIXED32]: "SFIXED32",
    [rt.ScalarType.SFIXED64]: "SFIXED64",
    [rt.ScalarType.SINT32]: "SINT32",
    [rt.ScalarType.SINT64]: "SINT64",
} as const;


/**
 * Generates TypeScript code for runtime field information,
 * from runtime field information.
 */
export class FieldInfoGenerator {


    // Use `2 /* NUMBER */` instead of `LongType.BIGINT`.
    // Necessary for typescript compiler option "isolatedModules".
    private inlineTypeEnums = true;


    constructor(
        private readonly registry: DescriptorRegistry,
        private readonly imports: TypescriptImportManager,
        private readonly options: {
            runtimeImportPath: string;
        },
    ) {
    }


    createFieldInfoLiterals(fieldInfos: readonly rt.PartialFieldInfo[]): ts.ArrayLiteralExpression {
        fieldInfos = fieldInfos.map(fi => FieldInfoGenerator.denormalizeFieldInfo(fi));
        return ts.createArrayLiteral(fieldInfos.map(fi => this.createFieldInfoLiteral(fi)), true);
    }


    createFieldInfoLiteral(fieldInfo: rt.PartialFieldInfo): ts.ObjectLiteralExpression {
        fieldInfo = FieldInfoGenerator.denormalizeFieldInfo(fieldInfo);
        let properties: ts.PropertyAssignment[] = [];

        // no: The field number of the .proto field.
        // name: The original name of the .proto field.
        // kind: discriminator
        // localName: The name of the field in the runtime.
        // jsonName: The name of the field in JSON.
        // oneof: The name of the `oneof` group, if this field belongs to one.
        for (let key of ["no", "name", "kind", "localName", "jsonName", "oneof"] as const) {
            if (fieldInfo[key] !== undefined) {
                properties.push(ts.createPropertyAssignment(
                    key, typescriptLiteralFromValue(fieldInfo[key])
                ));
            }
        }

        // repeat: Is the field repeated?
        if (fieldInfo.repeat !== undefined) {
            properties.push(ts.createPropertyAssignment(
                "repeat",
                this.createRepeatType(fieldInfo.repeat)
            ));
        }

        // opt: Is the field optional?
        if (fieldInfo.opt !== undefined) {
            properties.push(ts.createPropertyAssignment(
                "opt", typescriptLiteralFromValue(fieldInfo.opt)
            ));
        }

        switch (fieldInfo.kind) {
            case "scalar":

                // T: Scalar field type.
                properties.push(ts.createPropertyAssignment("T", this.createScalarType(fieldInfo.T)));

                // L?: JavaScript long type
                if (fieldInfo.L !== undefined) {
                    properties.push(ts.createPropertyAssignment("L", this.createLongType(fieldInfo.L)));
                }
                break;

            case "enum":
                // T: Return enum field type info.
                properties.push(ts.createPropertyAssignment(ts.createIdentifier('T'), this.createEnumT(fieldInfo.T())));
                break;

            case "message":
                // T: Return message field type handler.
                properties.push(ts.createPropertyAssignment(ts.createIdentifier('T'), this.createMessageT(fieldInfo.T())));
                break;


            case "map":
                // K: Map field key type.
                properties.push(ts.createPropertyAssignment("K", this.createScalarType(fieldInfo.K)));

                // V: Map field value type.
                properties.push(ts.createPropertyAssignment("V", this.createMapV(fieldInfo.V)));
                break;
        }

        // options:
        if (fieldInfo.options) {
            properties.push(ts.createPropertyAssignment(
                ts.createIdentifier('options'),
                typescriptLiteralFromValue(fieldInfo.options)
            ));
        }

        return ts.createObjectLiteral(properties, false);
    }


    /**
     * Turn normalized field info returned by normalizeFieldInfo() back into
     * the minimized form.
     */
    private static denormalizeFieldInfo(info: rt.PartialFieldInfo): rt.PartialFieldInfo {
        let partial: rt.PartialFieldInfo = {...info};
        if (info.jsonName === rt.lowerCamelCase(info.name)) {
            delete partial.jsonName;
        }
        if (info.localName === rt.lowerCamelCase(info.name)) {
            delete partial.localName;
        }
        if (info.repeat === rt.RepeatType.NO) {
            delete partial.repeat;
        }
        if (info.opt === false) {
            delete partial.opt;
        } else if (info.opt === true && info.kind == "message") {
            delete partial.opt;
        }
        return partial;
    }

    private createMessageT(type: rt.IMessageType<rt.UnknownMessage>): ts.ArrowFunction {
        let descriptor = this.registry.resolveTypeName(type.typeName);
        let generatedMessage = this.imports.type(descriptor);
        return ts.createArrowFunction(
            undefined, undefined, [], undefined,
            ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            ts.createIdentifier(generatedMessage)
        );
    }

    private createEnumT(ei: rt.EnumInfo): ts.ArrowFunction {
        let [pbTypeName, , sharedPrefix] = ei,
            descriptor = this.registry.resolveTypeName(pbTypeName),
            generatedEnum = this.imports.type(descriptor),
            enumInfoLiteral: ts.Expression[] = [
                ts.createStringLiteral(pbTypeName),
                ts.createIdentifier(generatedEnum),
            ];
        if (sharedPrefix) {
            enumInfoLiteral.push(ts.createStringLiteral(sharedPrefix));
        }
        return ts.createArrowFunction(
            undefined, undefined, [], undefined,
            ts.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            ts.createArrayLiteral(enumInfoLiteral, false)
        );
    }


    private createRepeatType(type: rt.RepeatType): ts.Expression {
        if (this.inlineTypeEnums) {
            const expr = ts.createNumericLiteral(type.toString());
            ts.addSyntheticTrailingComment(expr, ts.SyntaxKind.MultiLineCommentTrivia, `RepeatType.${repeatTypeMapping[type]}`);
            return expr;
        } else {
            return ts.createPropertyAccess(
                ts.createIdentifier(this.imports.name('RepeatType', this.options.runtimeImportPath)),
                repeatTypeMapping[type],
            );
        }
    }


    private createScalarType(type: rt.ScalarType): ts.Expression {
        if (this.inlineTypeEnums) {
            const expr = ts.createNumericLiteral(type.toString());
            ts.addSyntheticTrailingComment(expr, ts.SyntaxKind.MultiLineCommentTrivia, `ScalarType.${scalarTypeMapping[type]}`);
            return expr;
        } else {
            return ts.createPropertyAccess(
                ts.createIdentifier(this.imports.name('ScalarType', this.options.runtimeImportPath)),
                scalarTypeMapping[type],
            );
        }
    }


    private createLongType(type: rt.LongType): ts.Expression {
        if (this.inlineTypeEnums) {
            const expr = ts.createNumericLiteral(type.toString());
            ts.addSyntheticTrailingComment(expr, ts.SyntaxKind.MultiLineCommentTrivia, `LongType.${longTypeMapping[type]}`);
            return expr;
        } else {
            return ts.createPropertyAccess(
                ts.createIdentifier(this.imports.name('LongType', this.options.runtimeImportPath)),
                longTypeMapping[type],
            );
        }
    }


    // V: Map field value type.
    private createMapV(mapV: (rt.PartialFieldInfo & { kind: "map" })["V"]): ts.ObjectLiteralExpression {
        let T: ts.Expression;
        let L: ts.Expression | undefined = undefined;
        switch (mapV.kind) {
            case "message":
                T = this.createMessageT(mapV.T());
                break;
            case "enum":
                T = this.createEnumT(mapV.T());
                break;
            case "scalar":
                T = this.createScalarType(mapV.T);
                if (mapV.L)
                    L = this.createLongType(mapV.L);
                break;
        }
        let properties: ts.ObjectLiteralElementLike[] = [
            ts.createPropertyAssignment(ts.createIdentifier('kind'), ts.createStringLiteral(mapV.kind)),
            ts.createPropertyAssignment(ts.createIdentifier('T'), T)
        ];
        if (L) {
            ts.createPropertyAssignment(ts.createIdentifier('L'), L)
        }
        return ts.createObjectLiteral(properties);
    }


}
