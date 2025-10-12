export const roundToPrecision = (num, precision) => {
    const rounding = Math.round(1.0 / precision);
    return Math.round((num + Number.EPSILON) * rounding) / rounding;
};
