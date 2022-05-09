struct RGB {
  byte r;
  byte g;
  byte b;
};

RGB getBlue() { 
  RGB color = { 0 , 0 , 255 };
  return color;
}

RGB getWhite() { 
  RGB color = { 255 , 255 , 255 };
  return color;
}

String colorToStr(RGB color){
  return String("(") + color.r + "," + color.g + "," + color.b + ")";
}

RGB getColor(String red, String green, String blue){

  RGB color = {red.toInt(), green.toInt(), blue.toInt()};

  return color;
}

RGB getColor(int red, int green, int blue){

  RGB color = {red, green, blue};

  return color;
}

void printRGB(RGB color){
  Serial.print("Color: ");
  Serial.print(color.r);
  Serial.print(", ");
  Serial.print(color.g);
  Serial.print(", ");
  Serial.println(color.b);
}
